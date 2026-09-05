import Link from 'next/link';

import { regenerateDepartures } from '@/lib/operator/setup';
import { Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { addDays, formatServiceDate, formatTime, todayInToronto } from '@/lib/time';
import { legLoads, type CapacityBooking } from '@/lib/booking/capacity';

type DepartureRow = {
  id: string;
  service_date: string;
  departure_time: string;
  max_seats: number;
  status: string;
  route: { id: string; name: string; route_stops: { seq: number }[] } | null;
};

/**
 * The operator's view of what is on sale. The load bar is per leg, because a
 * 14-seat van can legitimately be carrying 30 bookings across a five-stop
 * route — what matters is whether any single stretch is full.
 */
export default async function DeparturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const [{ operatorId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const today = todayInToronto();
  const days = Number(query.days) || 14;
  const horizon = addDays(today, days);

  const departures = rows(
    await supabase
      .from('departures')
      .select(
        'id, service_date, departure_time, max_seats, status, route:routes(id, name, route_stops(seq))',
      )
      .eq('operator_id', operatorId)
      .gte('service_date', today)
      .lte('service_date', horizon)
      .order('service_date')
      .order('departure_time'),
    'your departures',
  ) as unknown as DepartureRow[];

  const bookings = departures.length
    ? rows(
        await supabase
          .from('bookings')
          .select('departure_id, from_seq, to_seq, seats, status, hold_expires_at')
          .in(
            'departure_id',
            departures.map((departure) => departure.id),
          ),
        'the seats sold on them',
      )
    : [];

  const byDeparture = new Map<string, CapacityBooking[]>();
  for (const booking of bookings) {
    const list = byDeparture.get(booking.departure_id) ?? [];
    list.push(booking);
    byDeparture.set(booking.departure_id, list);
  }

  const now = new Date();

  return (
    <>
      <PageHeader
        title="Departures"
        description={`On sale between ${formatServiceDate(today)} and ${formatServiceDate(horizon)}.`}
        action={
          <form action={regenerateDepartures}>
            <input type="hidden" name="operator_id" value={operatorId} />
            <Button type="submit" tone="secondary">
              Refresh the next 30 days
            </Button>
          </form>
        }
      />

      <Card>
        <CardHeader
          title="Seats taken, leg by leg"
          description="Each block is one stretch between two stops. A departure is full only where a block is full."
        />
        {departures.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="Nothing on sale yet"
              action={
                <Link
                  href={`/operator/${operatorId}/schedules`}
                  className="text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Set up a timetable →
                </Link>
              }
            >
              Departures appear here once a timetable entry is running.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Leaves</Th>
                <Th>Route</Th>
                <Th>Load per leg</Th>
                <Th className="text-right">Seats</Th>
                <Th className="text-right"> </Th>
              </tr>
            </thead>
            <tbody>
              {departures.map((departure) => {
                const stopCount = departure.route?.route_stops.length ?? 0;
                const loads = legLoads(byDeparture.get(departure.id) ?? [], stopCount, now);
                const busiest = loads.length ? Math.max(...loads) : 0;

                return (
                  <tr key={departure.id}>
                    <Td className="numeric whitespace-nowrap font-medium text-ink-900">
                      {formatServiceDate(departure.service_date)}
                    </Td>
                    <Td className="numeric whitespace-nowrap">
                      {formatTime(departure.departure_time)}
                    </Td>
                    <Td>{departure.route?.name ?? 'Route'}</Td>
                    <Td>
                      <div className="flex items-end gap-1">
                        {loads.map((load, index) => {
                          const full = load >= departure.max_seats;
                          return (
                            <span
                              key={index}
                              title={`Leg ${index + 1}: ${load} of ${departure.max_seats}`}
                              className={`inline-block h-6 w-8 rounded-sm ${
                                full ? 'bg-bad-100' : load > 0 ? 'bg-brand-100' : 'bg-ink-100'
                              }`}
                            >
                              <span
                                className={`numeric block text-center text-xs leading-6 ${
                                  full ? 'text-bad-700' : 'text-ink-600'
                                }`}
                              >
                                {load}
                              </span>
                            </span>
                          );
                        })}
                        {loads.length === 0 ? (
                          <span className="text-xs text-ink-400">route has no stops</span>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="numeric text-right whitespace-nowrap">
                      {busiest} / {departure.max_seats}
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/operator/${operatorId}/departures/${departure.id}`}
                        className="text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
