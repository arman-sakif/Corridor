import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RequestSeatForm } from './request-seat-form';
import { Alert, Card, EmptyState } from '@/components/ui';
import { departureBoardings } from '@/lib/booking/search';
import { getViewer, profileIsComplete } from '@/lib/auth/session';
import { formatServiceDateLong, formatTime, torontoInstant } from '@/lib/time';

export const metadata: Metadata = { title: 'Departure' };

export default async function DeparturePage({
  params,
  searchParams,
}: {
  params: Promise<{ departureId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ departureId }, query] = await Promise.all([params, searchParams]);

  const [departure, viewer] = await Promise.all([
    departureBoardings({
      departureId,
      fromCityId: query.from,
      toCityId: query.to,
    }),
    getViewer(),
  ]);

  if (!departure) notFound();

  const hasLeft = torontoInstant(departure.serviceDate, departure.departureTime) <= new Date();
  const available = departure.boardings.filter((boarding) => boarding.seatsLeft > 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/search" className="text-sm text-ink-600 hover:text-ink-900">
        ← Back to search
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          {departure.operator?.name}
        </h1>
        <p className="numeric mt-1 text-ink-700">
          {formatTime(departure.departureTime)} · {formatServiceDateLong(departure.serviceDate)}
        </p>
        {departure.operator?.bio ? (
          <p className="mt-3 text-sm text-ink-600">{departure.operator.bio}</p>
        ) : null}
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
          Where this one goes
        </h2>
        <ol className="mt-3 space-y-2">
          {departure.stops.map((stop) => (
            <li key={stop.stopId} className="flex gap-3 text-sm">
              <span className="numeric w-5 shrink-0 text-ink-400">{stop.seq}</span>
              <span>
                <span className="font-medium text-ink-900">{stop.cityName}</span>
                <span className="text-ink-600"> — {stop.label}</span>
                {stop.description ? (
                  <span className="block text-xs text-ink-500">{stop.description}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="mt-6">
        {hasLeft ? (
          <Alert tone="warn">This departure has already left. Try another date.</Alert>
        ) : departure.status !== 'scheduled' ? (
          <Alert tone="warn">This departure is no longer running.</Alert>
        ) : available.length === 0 ? (
          <EmptyState title="Full for that journey">
            Every seat on the stretch you need is taken. Another departure that day may still have
            room.
          </EmptyState>
        ) : !viewer ? (
          <Card className="p-5">
            <Alert tone="info">
              Sign in to request a seat. The operator needs a name and a phone number to confirm
              your pickup.
            </Alert>
            <div className="mt-4">
              <Link
                href={`/sign-in?next=${encodeURIComponent(`/departures/${departureId}?from=${query.from ?? ''}&to=${query.to ?? ''}`)}`}
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                Sign in or create an account →
              </Link>
            </div>
          </Card>
        ) : !profileIsComplete(viewer.profile) ? (
          <Card className="p-5">
            <Alert tone="info">
              Add your name and phone number first — the operator sees those when they decide.
            </Alert>
            <div className="mt-4">
              <Link
                href={`/profile?next=${encodeURIComponent(`/departures/${departureId}`)}`}
                className="font-medium text-brand-600 hover:text-brand-700"
              >
                Fill in your details →
              </Link>
            </div>
          </Card>
        ) : (
          <RequestSeatForm departureId={departureId} boardings={available} />
        )}
      </div>

      <p className="mt-6 text-center text-xs text-ink-500">
        Requesting holds your seat for one hour while the operator decides. Nothing is charged now —
        you pay the driver on the day.
      </p>
    </div>
  );
}
