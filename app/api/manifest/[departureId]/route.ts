import { NextResponse, type NextRequest } from 'next/server';

import { manifestCsv, manifestFilename, type ManifestRow } from '@/lib/booking/manifest';
import { createClient } from '@/lib/supabase/server';
import { one, rows } from '@/lib/supabase/rows';

/**
 * One CSV per vehicle per departure.
 *
 * Generated server-side under the caller's own session, so RLS decides what
 * they can see: a driver assigned to this departure, or a manager of the
 * operator. Anyone else gets a 404 rather than a 403 — there is no reason to
 * confirm the departure exists.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ departureId: string }> },
) {
  const { departureId } = await params;
  const vehicleId = request.nextUrl.searchParams.get('vehicle');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new NextResponse('Not found', { status: 404 });

  const departure = one(
    await supabase
      .from('departures')
      .select(
        `id, service_date, departure_time,
         operator:operators(name),
         route:routes(name)`,
      )
      .eq('id', departureId)
      .maybeSingle(),
    'the departure',
  );

  if (!departure) return new NextResponse('Not found', { status: 404 });

  const assignment = vehicleId
    ? one(
        await supabase
          .from('departure_vehicles')
          .select('vehicle:vehicles(id, label), driver:profiles(full_name)')
          .eq('departure_id', departureId)
          .eq('vehicle_id', vehicleId)
          .maybeSingle(),
        'the vehicle on this departure',
      )
    : null;

  if (vehicleId && !assignment) return new NextResponse('Not found', { status: 404 });

  let query = supabase
    .from('bookings')
    .select(
      `seats, luggage_count, total_cents, status, payment_method, driver_confirmed_at,
       passenger_note, from_seq,
       passenger:profiles(full_name, phone),
       from_stop:stops!bookings_from_stop_id_fkey(label),
       to_stop:stops!bookings_to_stop_id_fkey(label)`,
    )
    .eq('departure_id', departureId)
    .in('status', ['approved', 'completed', 'settled', 'no_show']);

  // No vehicle means the whole departure — useful before the operator has
  // split it across vans.
  query = vehicleId ? query.eq('assigned_vehicle_id', vehicleId) : query;

  // A refused query used to leave here as a 404, which reads as "no such
  // departure" — the one thing it is not. Fail loudly instead.
  const manifest: ManifestRow[] = rows(await query, 'the passenger list').map((booking) => ({
    from_stop: booking.from_stop?.label ?? '',
    to_stop: booking.to_stop?.label ?? '',
    passenger_name: booking.passenger?.full_name ?? 'Passenger',
    phone: booking.passenger?.phone ?? '',
    seats: booking.seats,
    luggage_count: booking.luggage_count,
    total_cents: booking.total_cents,
    status: booking.status,
    payment_method: booking.payment_method,
    driver_confirmed_at: booking.driver_confirmed_at,
    passenger_note: booking.passenger_note,
    from_seq: booking.from_seq,
  }));

  const operatorName = departure.operator?.name ?? 'Operator';
  const vehicleLabel = assignment?.vehicle?.label ?? 'All passengers';

  const csv = manifestCsv({
    operatorName,
    routeName: departure.route?.name ?? '',
    serviceDate: departure.service_date,
    departureTime: departure.departure_time,
    vehicleLabel,
    driverName: assignment?.driver?.full_name ?? null,
    rows: manifest,
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${manifestFilename(
        operatorName,
        departure.service_date,
        departure.departure_time,
        vehicleLabel,
      )}"`,
      'Cache-Control': 'no-store',
    },
  });
}
