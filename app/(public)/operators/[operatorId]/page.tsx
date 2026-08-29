import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge, Card, EmptyState } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatDaysOfWeek, formatTime } from '@/lib/time';

export const metadata: Metadata = { title: 'Operator' };

/**
 * The public profile. It shows the business, its corridors, and what
 * passengers have said. It shows nothing about drivers or vehicles — those are
 * the operator's business, decided late, and never a passenger's concern.
 */
export default async function OperatorProfilePage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const { data: operator } = await supabase
    .from('operators')
    .select('id, name, bio, public_phone, type')
    .eq('id', operatorId)
    .maybeSingle();

  if (!operator) notFound();

  const [{ data: routes }, { data: ratings }] = await Promise.all([
    supabase
      .from('routes')
      .select('id, name, route_stops(seq, stop:stops(label, city:cities(name)))')
      .eq('operator_id', operatorId)
      .eq('is_active', true),
    supabase
      .from('ratings')
      .select('score, comment, created_at')
      .eq('operator_id', operatorId)
      .eq('direction', 'passenger_to_operator')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const reviews = ratings ?? [];
  const average =
    reviews.length > 0
      ? (reviews.reduce((sum, rating) => sum + rating.score, 0) / reviews.length).toFixed(1)
      : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/operators" className="text-sm text-ink-600 hover:text-ink-900">
        ← All operators
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{operator.name}</h1>
          {operator.public_phone ? (
            <p className="numeric mt-1 text-ink-600">{operator.public_phone}</p>
          ) : null}
        </div>
        {average ? (
          <Badge tone="good">
            {average} out of 5 · {reviews.length} rating{reviews.length === 1 ? '' : 's'}
          </Badge>
        ) : null}
      </div>

      {operator.bio ? <p className="mt-4 text-ink-700">{operator.bio}</p> : null}

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
          Where they run
        </h2>
        {(routes ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">No routes published yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {(routes ?? []).map((route) => {
              const ordered = [...(route.route_stops ?? [])].sort((a, b) => a.seq - b.seq);
              return (
                <li key={route.id} className="rounded-xl bg-white p-4 ring-1 ring-ink-200">
                  <p className="font-medium text-ink-900">{route.name}</p>
                  <p className="mt-1 text-sm text-ink-600">
                    {ordered
                      .map((rs) => rs.stop?.city?.name ?? rs.stop?.label)
                      .filter(Boolean)
                      .join(' → ')}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
          What passengers said
        </h2>
        {reviews.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No ratings yet">
              Ratings appear here once passengers have travelled and rated the trip.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {reviews
              .filter((review) => review.comment)
              .map((review, index) => (
                <li key={index}>
                  <Card className="p-4">
                    <p className="numeric text-sm font-medium text-ink-900">
                      {review.score} out of 5
                    </p>
                    <p className="mt-1 text-sm text-ink-700">{review.comment}</p>
                  </Card>
                </li>
              ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-xs text-ink-500">
        {operator.name} runs its own vehicles and drivers, sets its own fares, and holds its own
        Ontario licensing and insurance. Corridor is the booking software.
      </p>
    </div>
  );
}
