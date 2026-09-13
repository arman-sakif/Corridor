import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RequestSeatForm } from './request-seat-form';
import { Alert, Badge, Card, EmptyState } from '@/components/ui';
import { IconArrowRight, IconClock, IconRoute, IconSeat } from '@/components/icons';
import { departureBoardings } from '@/lib/booking/search';
import { getViewer, profileIsComplete } from '@/lib/auth/session';
import { chooseAccountMode } from '@/lib/auth/mode-actions';
import { activeMode } from '@/lib/auth/mode-session';
import { availableModes } from '@/lib/auth/modes';
import { dynamicRoute } from '@/lib/routes';
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
    departureBoardings({ departureId, fromCityId: query.from, toCityId: query.to }),
    getViewer(),
  ]);

  if (!departure) notFound();

  // Anyone can look at a departure; a seat is requested from a passenger account.
  const mode = viewer ? await activeMode(viewer) : null;
  const hasPassenger = viewer ? availableModes(viewer).includes('passenger') : false;

  const hasLeft = torontoInstant(departure.serviceDate, departure.departureTime) <= new Date();
  const available = departure.boardings.filter((boarding) => boarding.seatsLeft > 0);

  // Which stretch of the route this passenger is actually buying, so the
  // timeline can show the rest as context rather than as equal choices.
  const firstSeq = available[0]?.from.seq;
  const lastSeq = available[0]?.to.seq;

  const backToSearch = dynamicRoute(
    query.from && query.to ? `/search?from=${query.from}&to=${query.to}` : '/search',
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <Link
        href={backToSearch}
        className="inline-flex items-center gap-1 text-sm text-ink-600 transition-colors hover:text-brand-700"
      >
        <IconArrowRight className="rotate-180 text-sm" />
        Back to search
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display text-2xl font-semibold text-ink-900">
            {departure.operator?.name}
          </h1>
          <p className="numeric mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-700">
            <IconClock className="text-base text-ink-400" />
            <span className="font-medium">{formatTime(departure.departureTime)}</span>
            <span className="text-ink-300">·</span>
            <span>{formatServiceDateLong(departure.serviceDate)}</span>
          </p>
        </div>
        {!hasLeft && departure.status === 'scheduled' && available.length > 0 ? (
          <Badge tone="good">
            <IconSeat className="text-sm" />
            {available[0]!.seatsLeft} available
          </Badge>
        ) : null}
      </div>

      {departure.operator?.bio ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-600">{departure.operator.bio}</p>
      ) : null}

      <Card className="mt-6 p-5">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-ink-500 uppercase">
          <IconRoute className="text-sm" />
          Where this one goes
        </h2>

        <ol className="route-line mt-4 space-y-4">
          {departure.stops.map((stop) => {
            const onSegment =
              firstSeq !== undefined &&
              lastSeq !== undefined &&
              stop.seq >= firstSeq &&
              stop.seq <= lastSeq;
            const isEnd = stop.seq === firstSeq || stop.seq === lastSeq;

            return (
              <li key={stop.stopId} className="relative flex gap-3.5 pl-0">
                <span
                  aria-hidden
                  className={
                    'relative z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full ring-4 ring-white ' +
                    (isEnd
                      ? 'bg-brand-600'
                      : onSegment
                        ? 'bg-brand-300'
                        : 'bg-ink-300')
                  }
                />
                <div className="min-w-0 pb-0.5">
                  <p
                    className={
                      'font-medium ' + (onSegment ? 'text-ink-900' : 'text-ink-500')
                    }
                  >
                    {stop.cityName}
                  </p>
                  <p className={'text-sm ' + (onSegment ? 'text-ink-600' : 'text-ink-400')}>
                    {stop.label}
                  </p>
                  {stop.description ? (
                    <p className="mt-0.5 text-xs text-ink-500">{stop.description}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 border-t border-ink-150 pt-3 text-xs text-ink-500">
          Times shown are for the first stop. Ask the operator for timing at yours.
        </p>
      </Card>

      <div className="mt-6">
        {hasLeft ? (
          <Alert tone="warn">This departure has already left. Try another date.</Alert>
        ) : departure.status !== 'scheduled' ? (
          <Alert tone="warn">This departure is no longer running.</Alert>
        ) : available.length === 0 ? (
          <EmptyState title="Full for that journey" icon={<IconSeat />}>
            Every seat on the stretch you need is taken. Another departure that day may still have
            room.
          </EmptyState>
        ) : !viewer ? (
          <Card className="p-5">
            <Alert tone="info">
              Sign in to request a seat. The operator needs a name and a phone number to confirm
              your pickup.
            </Alert>
            <Link
              href={dynamicRoute(
                `/sign-in?next=${encodeURIComponent(
                  `/departures/${departureId}?from=${query.from ?? ''}&to=${query.to ?? ''}`,
                )}`,
              )}
              className="group mt-4 inline-flex items-center gap-1.5 font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              Sign in or create an account
              <IconArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Card>
        ) : mode !== 'passenger' ? (
          <Card className="p-5">
            <Alert tone="info">
              {hasPassenger
                ? 'Seats are requested from your passenger account. Switch to it to carry on.'
                : 'Seats are requested from a passenger account, and yours is switched off. Turn it on in your profile to book.'}
            </Alert>
            {hasPassenger ? (
              <form action={chooseAccountMode} className="mt-4">
                <input type="hidden" name="mode" value="passenger" />
                <input
                  type="hidden"
                  name="next"
                  value={`/departures/${departureId}?from=${query.from ?? ''}&to=${query.to ?? ''}`}
                />
                <button
                  type="submit"
                  data-mode="passenger"
                  className="group inline-flex items-center gap-1.5 font-medium text-brand-600 transition-colors hover:text-brand-700"
                >
                  Switch to passenger
                  <IconArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </form>
            ) : (
              <Link
                href="/profile"
                className="group mt-4 inline-flex items-center gap-1.5 font-medium text-brand-600 transition-colors hover:text-brand-700"
              >
                Open your profile
                <IconArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </Card>
        ) : !profileIsComplete(viewer.profile) ? (
          <Card className="p-5">
            <Alert tone="info">
              Add your name and phone number first — the operator sees those when they decide.
            </Alert>
            <Link
              href={dynamicRoute(`/profile?next=${encodeURIComponent(`/departures/${departureId}`)}`)}
              className="group mt-4 inline-flex items-center gap-1.5 font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              Fill in your details
              <IconArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Card>
        ) : (
          <RequestSeatForm
            departureId={departureId}
            boardings={available}
            surcharges={departure.surcharges}
          />
        )}
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
        Requesting holds your seat for one hour while the operator decides. Nothing is charged now —
        you pay the driver on the day.
      </p>
    </div>
  );
}
