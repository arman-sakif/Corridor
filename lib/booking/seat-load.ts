import type { CapacityBooking } from '@/lib/booking/capacity';
import type { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';

type Client = Awaited<ReturnType<typeof createClient>>;

/** Departure ids per request — a long `in (…)` list is a long URL. */
const CHUNK = 40;
/** PostgREST's ceiling on one select. */
const PAGE = 1000;

/**
 * The bookings that can occupy a seat on each of these departures, for drawing
 * the seat view.
 *
 * Read in chunks and pages rather than one select: a list of requests can span
 * a month of departures, and a select that quietly stopped at 1000 rows would
 * draw full vans as half empty. RLS limits it to the reader's own operator.
 */
export async function bookingsByDeparture(
  supabase: Client,
  departureIds: string[],
): Promise<Map<string, CapacityBooking[]>> {
  const byDeparture = new Map<string, CapacityBooking[]>();

  for (let chunk = 0; chunk < departureIds.length; chunk += CHUNK) {
    const ids = departureIds.slice(chunk, chunk + CHUNK);

    for (let offset = 0; ; offset += PAGE) {
      const page = rows(
        await supabase
          .from('bookings')
          .select('id, departure_id, from_seq, to_seq, seats, status, hold_expires_at')
          .in('departure_id', ids)
          // Only the statuses that can take a seat; lapsed holds are dropped
          // later, by the clock, in countsTowardCapacity.
          .in('status', ['held', 'approved', 'completed', 'settled'])
          .order('id')
          .range(offset, offset + PAGE - 1),
        'the seats sold on these departures',
      );

      for (const booking of page) {
        const list = byDeparture.get(booking.departure_id) ?? [];
        list.push(booking);
        byDeparture.set(booking.departure_id, list);
      }

      if (page.length < PAGE) break;
    }
  }

  return byDeparture;
}
