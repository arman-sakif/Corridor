'use server';

import { revalidatePath } from 'next/cache';

import { requireOperatorRole, requireViewer } from '@/lib/auth/session';
import { activeMode } from '@/lib/auth/mode-session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { notify } from '@/lib/notify';
import { createClient } from '@/lib/supabase/server';
import { dynamicRoute } from '@/lib/routes';
import {
  incityRequestSchema,
  incityRideSchema,
  zoneSchema,
  zoneToggleSchema,
} from '@/lib/validation/incity';

/**
 * The in-city add-on's writes.
 *
 * Thin, like `lib/booking/actions.ts`: validate, authenticate, call the
 * Postgres function, tell someone. Nothing here decides a price or checks
 * whether a zone belongs to an operator — `request_incity_ride()` does both
 * while holding the row, and a check made here would be a check made against
 * a state that can change before the insert.
 *
 * Isolated by design: nothing in the intercity path imports this module.
 */

/* ------------------------------------------------------------------ zones */

export async function saveZone(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(zoneSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireOperatorRole(parsed.data.operator_id);

  const supabase = await createClient();
  const row = {
    operator_id: parsed.data.operator_id,
    name: parsed.data.name,
    flat_price_cents: parsed.data.price,
    is_active: parsed.data.is_active,
  };

  const { error } = parsed.data.zone_id
    ? await supabase.from('incity_zones').update(row).eq('id', parsed.data.zone_id)
    : await supabase.from('incity_zones').insert(row);

  if (error) {
    return fail(
      error.code === '23505'
        ? 'You already have an area with that name.'
        : 'We could not save that area. Try again in a moment.',
    );
  }

  revalidatePath(`/operator/${parsed.data.operator_id}/zones`);
  return succeed(`${parsed.data.name} saved.`);
}

/**
 * Takes an area off sale without deleting it. A zone with rides against it
 * cannot be removed — `incity_bookings.zone_id` is ON DELETE RESTRICT, which
 * is what stops an operator tidying up and taking booked rides with them.
 */
export async function toggleZone(formData: FormData): Promise<void> {
  const parsed = parseForm(zoneToggleSchema, formData);
  if (!parsed.ok) return;

  await requireOperatorRole(parsed.data.operator_id);

  const supabase = await createClient();
  const { data: zone } = await supabase
    .from('incity_zones')
    .select('is_active')
    .eq('id', parsed.data.zone_id)
    .maybeSingle();

  if (!zone) return;

  await supabase
    .from('incity_zones')
    .update({ is_active: !zone.is_active })
    .eq('id', parsed.data.zone_id);

  revalidatePath(`/operator/${parsed.data.operator_id}/zones`);
}

/* ------------------------------------------------------------------ rides */

export async function requestIncityRide(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(incityRequestSchema, formData);
  if (!parsed.ok) return parsed.state;

  const viewer = await requireViewer(`/my-rides/${parsed.data.booking_id}/onward`);

  if ((await activeMode(viewer)) !== 'passenger') {
    return fail('Local rides are booked from your passenger account. Switch to it from the header and try again.');
  }

  // The in-city operator needs to reach them the same way an intercity one
  // does, and for the same reason.
  if (!viewer.profile?.full_name || !viewer.profile.phone) {
    return fail('Add your name and phone number to your profile before booking a local ride.');
  }

  const supabase = await createClient();
  const { data: rideId, error } = await supabase.rpc('request_incity_ride', {
    p_booking_id: parsed.data.booking_id,
    p_operator_id: parsed.data.operator_id,
    p_pickup_stop_id: parsed.data.pickup_stop_id,
    p_zone_id: parsed.data.zone_id,
    p_destination_address: parsed.data.destination_address,
  });

  if (error || !rideId) {
    // The function raises messages written for the passenger, so they are safe
    // to show as they are.
    return fail(error?.message ?? 'We could not book that ride. Try again in a moment.');
  }

  await notify({
    kind: 'incity_requested',
    operatorId: parsed.data.operator_id,
    subject: 'A local ride has been requested',
    body: 'Someone arriving on an intercity booking has asked for a local drop-off. Confirm or decline it from your requests.',
    link: `/operator/${parsed.data.operator_id}/incity`,
  });

  revalidatePath(dynamicRoute(`/my-rides/${parsed.data.booking_id}`));
  return succeed('Requested. The operator will confirm it shortly.');
}

/**
 * Two actions rather than one taking a decision, so the requests queue is two
 * plain forms — the same shape the intercity queue uses, so an owner who runs
 * both kinds of business meets the same screen twice.
 */
export async function approveIncityRide(formData: FormData): Promise<void> {
  await decide(formData, 'approved');
}

export async function declineIncityRide(formData: FormData): Promise<void> {
  await decide(formData, 'declined');
}

async function decide(formData: FormData, decision: 'approved' | 'declined'): Promise<void> {
  const parsed = parseForm(incityRideSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.rpc(
    decision === 'approved' ? 'approve_incity_ride' : 'decline_incity_ride',
    { p_id: parsed.data.ride_id },
  );

  // The database authorises. A caller who is not a manager of the selling
  // operator gets an error here and nothing changes.
  if (!error) await notifyPassengerOfRideDecision(parsed.data.ride_id, decision);

  if (parsed.data.operator_id) {
    revalidatePath(dynamicRoute(`/operator/${parsed.data.operator_id}/incity`));
  }
  revalidatePath('/my-rides');
}

export async function cancelIncityRide(formData: FormData): Promise<void> {
  const parsed = parseForm(incityRideSchema, formData);
  if (!parsed.ok) return;

  await requireViewer('/my-rides');

  const supabase = await createClient();
  await supabase.rpc('cancel_incity_ride', { p_id: parsed.data.ride_id });

  if (parsed.data.booking_id) {
    revalidatePath(dynamicRoute(`/my-rides/${parsed.data.booking_id}`));
    revalidatePath(dynamicRoute(`/my-rides/${parsed.data.booking_id}/onward`));
  }
}

/**
 * The passenger is reached through the parent booking — `incity_bookings` has
 * no passenger of its own, only the booking it hangs off.
 */
async function notifyPassengerOfRideDecision(
  rideId: string,
  decision: 'approved' | 'declined',
): Promise<void> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('incity_bookings')
    .select('booking_id, destination_address, booking:bookings(passenger_id)')
    .eq('id', rideId)
    .maybeSingle();

  const row = data as unknown as {
    booking_id: string;
    destination_address: string;
    booking: { passenger_id: string } | null;
  } | null;

  if (!row?.booking?.passenger_id) return;

  await notify({
    kind: decision === 'approved' ? 'incity_approved' : 'incity_declined',
    passengerId: row.booking.passenger_id,
    bookingId: row.booking_id,
    subject:
      decision === 'approved' ? 'Your local ride is confirmed' : 'Your local ride was declined',
    body:
      decision === 'approved'
        ? `You have a local ride to ${row.destination_address}. Pay the driver on the day, the same as your seat.`
        : 'The local operator could not take that one. Your intercity seat is unaffected.',
    link: `/my-rides/${row.booking_id}/onward`,
  });
}
