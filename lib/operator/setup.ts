'use server';

import { revalidatePath } from 'next/cache';

import { requireOperatorRole } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import {
  fareSchema,
  routeSchema,
  scheduleSchema,
  stopSchema,
  surchargeSchema,
  vehicleSchema,
} from '@/lib/validation/operator';

/**
 * Everything an operator sets up before it can sell a seat.
 *
 * Each action re-checks membership through `requireOperatorRole` before it
 * writes, and RLS checks the same thing again underneath. Drivers are members
 * but not managers, so none of this is open to them.
 */

/* ------------------------------------------------------------------ stops */

export async function saveStop(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(stopSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { operator_id, stop_id, city_id, label, description, is_airport } = parsed.data;
  await requireOperatorRole(operator_id);

  const supabase = await createClient();
  const values = { city_id, label, description: description || null, is_airport };

  const { error } = stop_id
    ? await supabase.from('stops').update(values).eq('id', stop_id).eq('operator_id', operator_id)
    : await supabase.from('stops').insert({ ...values, operator_id });

  if (error) {
    return fail(
      error.code === '23505'
        ? 'You already have a stop with that name in that city.'
        : 'We could not save that stop. Try again in a moment.',
    );
  }

  revalidatePath(`/operator/${operator_id}/stops`);
  return succeed(stop_id ? 'Stop updated.' : `${label} is now one of your pickup points.`);
}

export async function setStopActive(formData: FormData): Promise<void> {
  const operatorId = formData.get('operator_id')?.toString();
  const stopId = formData.get('stop_id')?.toString();
  const isActive = formData.get('is_active') === 'true';
  if (!operatorId || !stopId) return;

  await requireOperatorRole(operatorId);

  const supabase = await createClient();
  await supabase
    .from('stops')
    .update({ is_active: isActive })
    .eq('id', stopId)
    .eq('operator_id', operatorId);

  revalidatePath(`/operator/${operatorId}/stops`);
}

/* ----------------------------------------------------------------- routes */

export async function saveRoute(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(routeSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { operator_id, route_id, name, pricing_mode, stop_ids } = parsed.data;
  await requireOperatorRole(operator_id);

  // One RPC rather than three writes: the route, its ordered stops, and the
  // pruning of fares that no longer point at a real position have to succeed
  // or fail together.
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_route', {
    p_operator_id: operator_id,
    p_route_id: route_id || null,
    p_name: name,
    p_pricing_mode: pricing_mode,
    p_stop_ids: stop_ids,
  });

  if (error) {
    return fail(error.message || 'We could not save that route. Try again in a moment.');
  }

  revalidatePath(`/operator/${operator_id}/routes`);
  return succeed(route_id ? 'Route updated.' : `${name} is ready for fares.`);
}

export async function setRouteActive(formData: FormData): Promise<void> {
  const operatorId = formData.get('operator_id')?.toString();
  const routeId = formData.get('route_id')?.toString();
  const isActive = formData.get('is_active') === 'true';
  if (!operatorId || !routeId) return;

  await requireOperatorRole(operatorId);

  const supabase = await createClient();
  await supabase
    .from('routes')
    .update({ is_active: isActive })
    .eq('id', routeId)
    .eq('operator_id', operatorId);

  revalidatePath(`/operator/${operatorId}/routes`);
}

/* ------------------------------------------------------------------ fares */

export async function setFare(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(fareSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { route_id, from_seq, to_seq, price, reason } = parsed.data;

  const supabase = await createClient();
  const { data: route } = await supabase
    .from('routes')
    .select('operator_id')
    .eq('id', route_id)
    .maybeSingle();

  if (!route) return fail('That route no longer exists.');
  await requireOperatorRole(route.operator_id);

  // The price and its audit row are written together, inside one transaction.
  const { error } = await supabase.rpc('set_fare', {
    p_route_id: route_id,
    p_from_seq: from_seq,
    p_to_seq: to_seq,
    p_price_cents: price,
    p_reason: reason,
  });

  if (error) return fail(error.message || 'We could not save that price.');

  revalidatePath(`/operator/${route.operator_id}/routes/${route_id}`);
  return succeed('Price saved.');
}

/** Luggage and airport fees. Cash and e-transfer are unaffected — they cost
 *  the same, and nothing here can make them differ. */
export async function saveSurcharges(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(surchargeSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { operator_id, free_luggage_per_seat, extra_luggage, airport_fee } = parsed.data;
  await requireOperatorRole(operator_id, ['owner']);

  const supabase = await createClient();
  const { error } = await supabase
    .from('operators')
    .update({
      free_luggage_per_seat,
      extra_luggage_cents: extra_luggage,
      airport_fee_cents: airport_fee,
    })
    .eq('id', operator_id);

  if (error) return fail('We could not save those charges. Try again in a moment.');

  revalidatePath(`/operator/${operator_id}/settings`);
  return succeed('Saved. These apply to bookings made from now on.');
}

/* -------------------------------------------------------------- schedules */

export async function saveSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(scheduleSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { operator_id, schedule_id, route_id, ...rest } = parsed.data;
  await requireOperatorRole(operator_id);

  const supabase = await createClient();

  // The route must be this operator's own, and it must have stops — a schedule
  // on a route with no stops would generate departures nobody can book.
  const { data: route } = await supabase
    .from('routes')
    .select('id, operator_id, route_stops(id)')
    .eq('id', route_id)
    .eq('operator_id', operator_id)
    .maybeSingle();

  if (!route) return fail('That route is not one of yours.');
  if ((route.route_stops ?? []).length < 2) {
    return fail('Add at least two stops to that route before you put it on a timetable.');
  }

  const values = {
    route_id,
    departure_time: rest.departure_time,
    days_of_week: rest.days_of_week,
    max_seats: rest.max_seats,
    active_from: rest.active_from,
    active_to: rest.active_to || null,
  };

  const { error } = schedule_id
    ? await supabase.from('schedules').update(values).eq('id', schedule_id)
    : await supabase.from('schedules').insert(values);

  if (error) return fail('We could not save that timetable entry. Try again in a moment.');

  // Departures for the new window appear straight away, rather than waiting
  // for the nightly job.
  await supabase.rpc('generate_departures', { p_operator_id: operator_id, p_days: 30 });

  revalidatePath(`/operator/${operator_id}/schedules`);
  revalidatePath(`/operator/${operator_id}/departures`);
  return succeed(schedule_id ? 'Timetable updated.' : 'Departures are now on sale.');
}

export async function setScheduleActive(formData: FormData): Promise<void> {
  const operatorId = formData.get('operator_id')?.toString();
  const scheduleId = formData.get('schedule_id')?.toString();
  const isActive = formData.get('is_active') === 'true';
  if (!operatorId || !scheduleId) return;

  await requireOperatorRole(operatorId);

  const supabase = await createClient();
  await supabase.from('schedules').update({ is_active: isActive }).eq('id', scheduleId);

  // Departures already generated stay on sale. Stopping a schedule stops new
  // ones being created; cancelling a departure that is already sold is a
  // separate, deliberate act.
  revalidatePath(`/operator/${operatorId}/schedules`);
}

/* ------------------------------------------------------------------ fleet */

export async function saveVehicle(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(vehicleSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { operator_id, vehicle_id, label, seat_count } = parsed.data;
  await requireOperatorRole(operator_id);

  const supabase = await createClient();
  const values = { label, seat_count };

  const { error } = vehicle_id
    ? await supabase
        .from('vehicles')
        .update(values)
        .eq('id', vehicle_id)
        .eq('operator_id', operator_id)
    : await supabase.from('vehicles').insert({ ...values, operator_id });

  if (error) return fail('We could not save that vehicle. Try again in a moment.');

  revalidatePath(`/operator/${operator_id}/fleet`);
  return succeed(vehicle_id ? 'Vehicle updated.' : `${label} is in your fleet.`);
}

export async function setVehicleActive(formData: FormData): Promise<void> {
  const operatorId = formData.get('operator_id')?.toString();
  const vehicleId = formData.get('vehicle_id')?.toString();
  const isActive = formData.get('is_active') === 'true';
  if (!operatorId || !vehicleId) return;

  await requireOperatorRole(operatorId);

  const supabase = await createClient();
  await supabase
    .from('vehicles')
    .update({ is_active: isActive })
    .eq('id', vehicleId)
    .eq('operator_id', operatorId);

  revalidatePath(`/operator/${operatorId}/fleet`);
}

/* ------------------------------------------------------ departure window */

export async function regenerateDepartures(formData: FormData): Promise<void> {
  const operatorId = formData.get('operator_id')?.toString();
  if (!operatorId) return;

  await requireOperatorRole(operatorId);

  const supabase = await createClient();
  await supabase.rpc('generate_departures', { p_operator_id: operatorId, p_days: 30 });

  revalidatePath(`/operator/${operatorId}/departures`);
}
