'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/session';
import { activeMode } from '@/lib/auth/mode-session';
import { fail, parseForm, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { notify } from '@/lib/notify';
import { bookingIdSchema, requestSeatSchema } from '@/lib/validation/booking';

/**
 * Requesting a seat.
 *
 * The whole check-and-insert happens inside `request_booking()`, which locks
 * the departure row first. Nothing here counts seats or computes a price — a
 * read-then-write from this side would be a race, and a price from the client
 * would be a price the passenger chose.
 */
export async function requestSeat(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(requestSeatSchema, formData);
  if (!parsed.ok) return parsed.state;

  const viewer = await requireViewer(`/departures/${parsed.data.departure_id}`);

  // A seat is booked from a passenger account. An operator browsing search in
  // their operator account is shown a switch instead of this form, so this is
  // the backstop for a stale page.
  if ((await activeMode(viewer)) !== 'passenger') {
    return fail('Seats are requested from your passenger account. Switch to it from the header and try again.');
  }

  if (!viewer.profile?.full_name || !viewer.profile.phone) {
    return fail('Add your name and phone number to your profile before requesting a seat.');
  }

  const [fromStopId, toStopId] = parsed.data.boarding.split(':') as [string, string];

  const supabase = await createClient();
  const { data: bookingId, error } = await supabase.rpc('request_booking', {
    p_departure_id: parsed.data.departure_id,
    p_from_stop_id: fromStopId,
    p_to_stop_id: toStopId,
    p_seats: parsed.data.seats,
    p_luggage_count: parsed.data.luggage_count,
    p_passenger_note: parsed.data.passenger_note || null,
    // A code, never an amount. A wrong or spent one stops the booking with a
    // message saying which — quietly charging full price for a trip somebody
    // thought was discounted is the worst of the available outcomes.
    p_voucher_code: parsed.data.voucher_code || null,
  });

  if (error || !bookingId) {
    // The function raises messages written for the passenger, so they are safe
    // to show as-is.
    return fail(error?.message ?? 'We could not hold that seat. Try again in a moment.');
  }

  await notifyOperatorOfRequest(bookingId);

  revalidatePath('/my-rides');
  redirect(`/my-rides/${bookingId}?requested=1`);
}

export async function cancelBooking(formData: FormData): Promise<void> {
  const parsed = parseForm(bookingIdSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/my-rides');

  const supabase = await createClient();
  // The function decides whether this is a passenger cancelling or an operator
  // cancelling, and refuses anyone who is neither.
  await supabase.rpc('cancel_booking', { p_booking_id: parsed.data.booking_id });

  revalidatePath('/my-rides');
  revalidatePath(`/my-rides/${parsed.data.booking_id}`);
}

export async function approveBooking(formData: FormData): Promise<void> {
  const parsed = parseForm(bookingIdSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.rpc('approve_booking', {
    p_booking_id: parsed.data.booking_id,
  });

  if (!error) await notifyPassengerOfDecision(parsed.data.booking_id, 'approved');

  revalidatePath('/my-rides');
  await revalidateOperatorViews(parsed.data.booking_id);
}

export async function declineBooking(formData: FormData): Promise<void> {
  const parsed = parseForm(bookingIdSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.rpc('decline_booking', {
    p_booking_id: parsed.data.booking_id,
  });

  if (!error) await notifyPassengerOfDecision(parsed.data.booking_id, 'declined');

  revalidatePath('/my-rides');
  await revalidateOperatorViews(parsed.data.booking_id);
}

/* ------------------------------------------------------------ plumbing */

async function revalidateOperatorViews(bookingId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('bookings')
    .select('departure_id, departure:departures(operator_id)')
    .eq('id', bookingId)
    .maybeSingle();

  const operatorId = (data?.departure as unknown as { operator_id: string } | null)?.operator_id;
  if (!operatorId) return;

  revalidatePath(`/operator/${operatorId}/bookings`);
  revalidatePath(`/operator/${operatorId}/departures/${data!.departure_id}`);
}

/**
 * A hold expires in an hour, so the operator has to hear about it quickly.
 * Email is the MVP channel; `notify()` is where a second one would go.
 */
async function notifyOperatorOfRequest(bookingId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from('bookings')
    .select(
      'id, seats, hold_expires_at, departure:departures(id, operator_id, service_date, departure_time)',
    )
    .eq('id', bookingId)
    .maybeSingle();

  const departure = data?.departure as unknown as {
    id: string;
    operator_id: string;
    service_date: string;
    departure_time: string;
  } | null;
  if (!departure) return;

  await notify({
    kind: 'seat_requested',
    operatorId: departure.operator_id,
    bookingId,
    subject: 'A seat has been requested',
    body:
      `Someone has requested ${data!.seats} seat(s) on your ` +
      `${departure.service_date} departure. You have an hour to approve or decline it ` +
      `before the hold lapses and the seat goes back on sale.`,
    link: `/operator/${departure.operator_id}/bookings`,
  });
}

async function notifyPassengerOfDecision(bookingId: string, decision: 'approved' | 'declined') {
  const supabase = await createClient();

  const { data } = await supabase
    .from('bookings')
    .select('id, passenger_id, departure:departures(service_date, departure_time)')
    .eq('id', bookingId)
    .maybeSingle();

  if (!data) return;

  const departure = data.departure as unknown as {
    service_date: string;
    departure_time: string;
  } | null;

  await notify({
    kind: decision === 'approved' ? 'booking_approved' : 'booking_declined',
    passengerId: data.passenger_id,
    bookingId,
    subject: decision === 'approved' ? 'Your seat is confirmed' : 'Your seat request was declined',
    body:
      decision === 'approved'
        ? `You have a seat on the ${departure?.service_date} departure. Pay the driver on the day — cash or e-transfer, same price.`
        : `The operator could not take your request for the ${departure?.service_date} departure. Other operators may still have room.`,
    link: `/my-rides/${bookingId}`,
  });
}
