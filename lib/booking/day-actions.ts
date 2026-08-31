'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import {
  assignVehicleSchema,
  completeDepartureSchema,
  departureVehicleSchema,
  driverPaymentSchema,
  markNoShowSchema,
  paymentConfirmSchema,
  ratingSchema,
  redFlagSchema,
} from '@/lib/validation/booking';

/**
 * Departure day: assigning vehicles, running the trip, and settling up.
 *
 * Every one of these calls a Postgres function that checks the caller is
 * either a manager of the operator or the driver assigned to that departure.
 * The action layer authenticates; the database authorises.
 */

export async function addVehicleToDeparture(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(departureVehicleSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.from('departure_vehicles').insert({
    departure_id: parsed.data.departure_id,
    vehicle_id: parsed.data.vehicle_id,
    driver_id: parsed.data.driver_id || null,
  });

  if (error) {
    return fail(
      error.code === '23505'
        ? 'That vehicle is already on this departure.'
        : 'We could not add that vehicle. Try again in a moment.',
    );
  }

  await revalidateDeparture(parsed.data.departure_id);
  return succeed('Vehicle added.');
}

export async function removeVehicleFromDeparture(formData: FormData): Promise<void> {
  const departureVehicleId = formData.get('departure_vehicle_id')?.toString();
  const departureId = formData.get('departure_id')?.toString();
  if (!departureVehicleId || !departureId) return;

  await requireViewer('/');

  const supabase = await createClient();

  // Passengers already put in this van go back to unassigned rather than
  // pointing at a vehicle that is no longer running.
  const { data: link } = await supabase
    .from('departure_vehicles')
    .select('vehicle_id')
    .eq('id', departureVehicleId)
    .maybeSingle();

  if (link) {
    await supabase
      .from('bookings')
      .update({ assigned_vehicle_id: null })
      .eq('departure_id', departureId)
      .eq('assigned_vehicle_id', link.vehicle_id);
  }

  await supabase.from('departure_vehicles').delete().eq('id', departureVehicleId);

  await revalidateDeparture(departureId);
}

export async function assignBookingVehicle(formData: FormData): Promise<void> {
  const parsed = parseForm(assignVehicleSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/');

  const supabase = await createClient();
  await supabase.rpc('assign_booking_vehicle', {
    p_booking_id: parsed.data.booking_id,
    p_vehicle_id: parsed.data.vehicle_id || null,
  });

  const { data } = await supabase
    .from('bookings')
    .select('departure_id')
    .eq('id', parsed.data.booking_id)
    .maybeSingle();

  if (data) await revalidateDeparture(data.departure_id);
}

export async function completeDeparture(formData: FormData): Promise<void> {
  const parsed = parseForm(completeDepartureSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/');

  const supabase = await createClient();
  await supabase.rpc('complete_departure', { p_departure_id: parsed.data.departure_id });

  revalidatePath('/driver');
  revalidatePath('/my-rides');
  await revalidateDeparture(parsed.data.departure_id);
}

export async function markNoShow(formData: FormData): Promise<void> {
  const parsed = parseForm(markNoShowSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/');

  const supabase = await createClient();
  await supabase.rpc('mark_no_show', { p_booking_id: parsed.data.booking_id });

  const { data } = await supabase
    .from('bookings')
    .select('departure_id')
    .eq('id', parsed.data.booking_id)
    .maybeSingle();

  revalidatePath('/driver');
  if (data) await revalidateDeparture(data.departure_id);
}

/* ------------------------------------------------------------- payment */

export async function confirmPaymentAsPassenger(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(paymentConfirmSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireViewer('/my-rides');

  const supabase = await createClient();
  const { error } = await supabase.rpc('confirm_payment_as_passenger', {
    p_booking_id: parsed.data.booking_id,
    p_payment_method: parsed.data.payment_method,
  });

  if (error) return fail(error.message || 'We could not record that. Try again in a moment.');

  revalidatePath(`/my-rides/${parsed.data.booking_id}`);
  return succeed('Thanks — noted.');
}

export async function confirmPaymentAsDriver(formData: FormData): Promise<void> {
  const parsed = parseForm(driverPaymentSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/driver');

  const supabase = await createClient();
  await supabase.rpc('confirm_payment_as_driver', {
    p_booking_id: parsed.data.booking_id,
    p_received: parsed.data.received === 'yes',
  });

  revalidatePath('/driver');
  revalidatePath('/my-rides');
}

/* --------------------------------------------------- ratings and flags */

/**
 * The operator's rating of a passenger.
 *
 * Through `rate_passenger()` because the caller may be the assigned driver,
 * who holds no write policy anywhere and reaches every write through a
 * function that first proves they were on that trip. The function also decides
 * *who* is being rated, from the booking — there is no parameter for it.
 *
 * A rating is not a red flag. A flag says something went wrong; this is how a
 * passenger with ten uneventful trips gets to look like one.
 */
export async function ratePassenger(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(ratingSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.rpc('rate_passenger', {
    p_booking_id: parsed.data.booking_id,
    p_score: parsed.data.score,
    p_comment: parsed.data.comment || null,
  });

  if (error) return fail(error.message);

  const { data: booking } = await supabase
    .from('bookings')
    .select('departure_id')
    .eq('id', parsed.data.booking_id)
    .maybeSingle();

  if (booking?.departure_id) await revalidateDeparture(booking.departure_id);
  revalidatePath('/driver');

  return succeed('Recorded. It shows to operators deciding on their next request.');
}

export async function rateOperator(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(ratingSchema, formData);
  if (!parsed.ok) return parsed.state;

  const viewer = await requireViewer('/my-rides');

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, passenger_id, status, departure:departures(operator_id)')
    .eq('id', parsed.data.booking_id)
    .maybeSingle();

  const operatorId = (booking?.departure as unknown as { operator_id: string } | null)?.operator_id;

  if (!booking || booking.passenger_id !== viewer.userId || !operatorId) {
    return fail('That ride is not yours to rate.');
  }
  if (booking.status !== 'completed' && booking.status !== 'settled') {
    return fail('You can rate the operator once the trip has run.');
  }

  const { error } = await supabase.from('ratings').insert({
    booking_id: booking.id,
    direction: 'passenger_to_operator',
    rater_id: viewer.userId,
    operator_id: operatorId,
    passenger_id: viewer.userId,
    score: parsed.data.score,
    comment: parsed.data.comment || null,
  });

  if (error) {
    return fail(
      error.code === '23505'
        ? 'You have already rated this trip.'
        : 'We could not save that rating. Try again in a moment.',
    );
  }

  revalidatePath(`/my-rides/${booking.id}`);
  return succeed('Thanks — that helps the next passenger.');
}

/**
 * Marks a passenger, from either side of the operator.
 *
 * Through `raise_red_flag()` rather than an insert, because
 * `red_flags_insert_operator` requires `is_operator_manager` — which meant the
 * one person who actually watched the trip happen, the driver, could not
 * record what they saw. The function admits a manager or the driver assigned
 * to that departure, exactly as `mark_no_show()` does, and resolves the
 * operator and passenger from the booking so neither can be handed in.
 */
export async function raiseRedFlag(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(redFlagSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.rpc('raise_red_flag', {
    p_booking_id: parsed.data.booking_id,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note || null,
  });

  if (error) return fail(error.message);

  const { data: booking } = await supabase
    .from('bookings')
    .select('departure_id')
    .eq('id', parsed.data.booking_id)
    .maybeSingle();

  if (booking?.departure_id) await revalidateDeparture(booking.departure_id);
  revalidatePath('/driver');

  return succeed('Recorded. Other operators will see this before they approve a request.');
}

/* ------------------------------------------------------------ plumbing */

async function revalidateDeparture(departureId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('departures')
    .select('operator_id')
    .eq('id', departureId)
    .maybeSingle();

  if (!data) return;
  revalidatePath(`/operator/${data.operator_id}/departures/${departureId}`);
  revalidatePath(`/operator/${data.operator_id}/departures`);
  revalidatePath(`/operator/${data.operator_id}/bookings`);
}
