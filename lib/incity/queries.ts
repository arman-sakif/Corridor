import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { one, rows } from '@/lib/supabase/rows';
import type { IncityBookingStatus } from '@/lib/supabase/database.types';

/**
 * Reading the in-city add-on.
 *
 * Isolated by design: nothing in the intercity path imports this module. The
 * add-on has to be removable without touching the core booking flow, so the
 * dependency only ever points this way — in-city reads bookings, bookings know
 * nothing about in-city.
 */

export type IncityOffer = {
  operatorId: string;
  operatorName: string;
  publicPhone: string | null;
  pickups: { id: string; label: string; description: string | null }[];
  zones: { id: string; name: string; flatPriceCents: number }[];
};

export type IncityRide = {
  id: string;
  status: IncityBookingStatus;
  destinationAddress: string;
  priceCents: number;
  createdAt: string;
  zoneName: string;
  pickupLabel: string;
  operatorName: string;
  operatorPhone: string | null;
};

/**
 * Who can take this passenger onward from where they are being dropped.
 *
 * Matching is by city. An in-city operator declares its own pickup points, and
 * a booking arriving in that city is offered the operators with one there.
 * There is no join table between an operator and the places it serves, and no
 * geography anywhere — the city is the whole of the match.
 */
export async function offersFor(dropCityId: string): Promise<IncityOffer[]> {
  const supabase = await createClient();

  // Two reads rather than one nested select: the join is operator→stops and
  // operator→zones, which PostgREST would return as a cross product.
  const stopResult = await supabase
    .from('stops')
    .select('id, label, description, operator:operators!inner(id, name, type, status, public_phone)')
    .eq('city_id', dropCityId)
    .eq('is_active', true)
    .eq('operator.type', 'incity')
    .eq('operator.status', 'active')
    .order('label');

  type StopRow = {
    id: string;
    label: string;
    description: string | null;
    operator: { id: string; name: string; public_phone: string | null } | null;
  };

  const stops = rows(stopResult, 'the local operators there') as unknown as StopRow[];
  if (stops.length === 0) return [];

  const operatorIds = [...new Set(stops.map((row) => row.operator?.id).filter(Boolean))] as string[];

  const zones = rows(
    await supabase
      .from('incity_zones')
      .select('id, name, flat_price_cents, operator_id')
      .in('operator_id', operatorIds)
      .eq('is_active', true)
      .order('flat_price_cents'),
    'their zones',
  );

  const byOperator = new Map<string, IncityOffer>();

  for (const row of stops) {
    const operator = row.operator;
    if (!operator) continue;

    const existing = byOperator.get(operator.id) ?? {
      operatorId: operator.id,
      operatorName: operator.name,
      publicPhone: operator.public_phone,
      pickups: [],
      zones: [],
    };

    existing.pickups.push({ id: row.id, label: row.label, description: row.description });
    byOperator.set(operator.id, existing);
  }

  for (const zone of zones) {
    const offer = byOperator.get(zone.operator_id);
    if (offer) {
      offer.zones.push({
        id: zone.id,
        name: zone.name,
        flatPriceCents: zone.flat_price_cents,
      });
    }
  }

  // An operator with pickup points but no priced zones has nothing to sell.
  return [...byOperator.values()].filter((offer) => offer.zones.length > 0);
}

/** The live local ride on a booking, if there is one. */
export async function rideFor(bookingId: string): Promise<IncityRide | null> {
  const supabase = await createClient();

  const data = one(
    await supabase
      .from('incity_bookings')
      .select(
        `id, status, destination_address, price_cents, created_at,
         zone:incity_zones(name),
         pickup:stops(label),
         operator:operators(name, public_phone)`,
      )
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'the local ride on this booking',
  );

  if (!data) return null;

  const row = data as unknown as {
    id: string;
    status: IncityBookingStatus;
    destination_address: string;
    price_cents: number;
    created_at: string;
    zone: { name: string } | null;
    pickup: { label: string } | null;
    operator: { name: string; public_phone: string | null } | null;
  };

  return {
    id: row.id,
    status: row.status,
    destinationAddress: row.destination_address,
    priceCents: row.price_cents,
    createdAt: row.created_at,
    zoneName: row.zone?.name ?? 'Unknown area',
    pickupLabel: row.pickup?.label ?? 'Unknown pickup point',
    operatorName: row.operator?.name ?? 'the operator',
    operatorPhone: row.operator?.public_phone ?? null,
  };
}
