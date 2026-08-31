import { Badge } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

/**
 * The passenger's record across the whole platform, as counts.
 *
 * An operator deciding on a request should know if this is someone's tenth
 * ride or their fourth cancellation. They do not get to see where those trips
 * went or who ran them — `passenger_history()` returns aggregates only, and
 * only about someone who has actually requested a seat with them.
 */
export async function PassengerHistory({ passengerId }: { passengerId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc('passenger_history', { p_passenger_id: passengerId });

  const history = data?.[0];
  if (!history) return null;

  const isNew =
    history.completed === 0 &&
    history.cancelled === 0 &&
    history.no_shows === 0 &&
    history.red_flags === 0 &&
    history.rating_count === 0;

  if (isNew) {
    return (
      <p className="mt-2 text-xs text-ink-500">
        First time booking on Corridor — no history either way.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-500">On Corridor:</span>
      <Badge tone="good">{history.completed} completed</Badge>
      {history.rating_count > 0 ? (
        // The one thing on this line that is good news rather than the absence
        // of bad news. An operator weighing up a stranger had four counts,
        // three of which were ways it could go wrong.
        <Badge tone="good">
          {history.rating_avg} out of 5 from {history.rating_count} operator
          {history.rating_count === 1 ? '' : 's'}
        </Badge>
      ) : null}
      {history.cancelled > 0 ? (
        <Badge tone="neutral">{history.cancelled} cancelled or lapsed</Badge>
      ) : null}
      {history.no_shows > 0 ? <Badge tone="bad">{history.no_shows} no-show</Badge> : null}
      {history.red_flags > 0 ? (
        <Badge tone="bad">
          {history.red_flags} flag{history.red_flags === 1 ? '' : 's'}
        </Badge>
      ) : null}
    </div>
  );
}
