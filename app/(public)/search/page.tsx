import type { Metadata } from 'next';
import Link from 'next/link';

import { SearchForm } from '@/components/search-form';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui';
import { IconArrowRight, IconPin, IconRoute, IconSearch } from '@/components/icons';
import { searchDepartures } from '@/lib/booking/search';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { dynamicRoute } from '@/lib/routes';
import { formatCents } from '@/lib/money';
import {
  addDays,
  formatServiceDateLong,
  formatTime,
  isValidServiceDate,
  todayInToronto,
} from '@/lib/time';

export const metadata: Metadata = { title: 'Search' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const cities = rows(
    await supabase.from('cities').select('id, name').eq('is_active', true).order('name'),
    'the city list',
  );

  const cityName = new Map(cities.map((city) => [city.id, city.name]));
  const today = todayInToronto();
  const date = params.date && isValidServiceDate(params.date) ? params.date : today;

  const ready = Boolean(params.from && params.to && params.from !== params.to);
  const results = ready
    ? await searchDepartures({ fromCityId: params.from!, toCityId: params.to!, date })
    : [];

  const from = cityName.get(params.from ?? '') ?? 'Origin';
  const to = cityName.get(params.to ?? '') ?? 'Destination';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <SearchForm
        cities={cities}
        defaults={{ from: params.from ?? '', to: params.to ?? '', date }}
      />

      {!ready ? (
        <div className="mt-8">
          <EmptyState title="Choose where you are going" icon={<IconSearch />}>
            Pick the city you are leaving from and the city you are heading to.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-8 mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h1 className="display flex items-center gap-2 text-xl font-semibold text-ink-900">
              {from}
              <IconArrowRight className="text-base text-ink-400" />
              {to}
            </h1>
            <p className="text-sm text-ink-600">
              {formatServiceDateLong(date)} ·{' '}
              <span className="numeric">{results.length}</span>{' '}
              {results.length === 1 ? 'departure' : 'departures'}
            </p>
          </div>

          {results.length === 0 ? (
            <EmptyState
              title="Nothing running that day"
              icon={<IconRoute />}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <ButtonLink
                    href={dynamicRoute(
                      `/search?from=${params.from}&to=${params.to}&date=${addDays(date, 1)}`,
                    )}
                    tone="secondary"
                    size="sm"
                  >
                    Try the next day
                  </ButtonLink>
                  <ButtonLink href="/operators" tone="ghost" size="sm">
                    Browse operators
                  </ButtonLink>
                </div>
              }
            >
              No operator has a departure between those cities on {formatServiceDateLong(date)}.
              Another date may be busier.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {results.map((result) => {
                const cheapest = result.boardings[0];
                const extraPickups = result.boardings.length - 1;

                return (
                  <li key={result.departureId}>
                    <Card className="overflow-hidden transition-shadow hover:shadow-raised">
                      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch sm:p-5">
                        {/* Time and operator: what a passenger actually chooses between. */}
                        <div className="flex min-w-0 flex-1 gap-4">
                          <div className="shrink-0 text-center">
                            <p className="numeric text-2xl leading-tight font-semibold text-ink-900">
                              {formatTime(result.departureTime)}
                            </p>
                            <p className="mt-0.5 text-xs text-ink-500">departs</p>
                          </div>

                          <div className="min-w-0 border-l border-ink-150 pl-4">
                            <p className="truncate font-semibold text-ink-900">
                              {result.operator.name}
                            </p>

                            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-600">
                              <IconPin className="mt-0.5 shrink-0 text-sm text-ink-400" />
                              <span className="min-w-0">
                                {cheapest?.fromStopLabel}
                                {extraPickups > 0 ? (
                                  <span className="text-ink-500">
                                    {' '}
                                    or {extraPickups} other pickup
                                    {extraPickups > 1 ? 's' : ''}
                                  </span>
                                ) : null}
                              </span>
                            </p>

                            <div className="mt-2">
                              {result.seatsLeft <= 3 ? (
                                <Badge tone="warn">
                                  {result.seatsLeft} seat{result.seatsLeft === 1 ? '' : 's'} left
                                </Badge>
                              ) : (
                                <Badge tone="good">Seats available</Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Price and the action. */}
                        <div className="flex items-center justify-between gap-4 border-t border-ink-150 pt-3 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5">
                          <div className="sm:text-right">
                            <p className="numeric text-2xl font-semibold text-ink-900">
                              {formatCents(result.fromCents)}
                            </p>
                            <p className="text-xs text-ink-500">per seat</p>
                          </div>
                          <ButtonLink
                            href={dynamicRoute(
                              `/departures/${result.departureId}?from=${params.from}&to=${params.to}`,
                            )}
                            className="shrink-0"
                          >
                            Choose
                            <IconArrowRight />
                          </ButtonLink>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 border-t border-ink-150 bg-ink-50/70 px-4 py-2 sm:px-5">
                        <Link
                          href={dynamicRoute(`/operators/${result.operator.id}`)}
                          className="text-xs font-medium text-ink-600 transition-colors hover:text-brand-700"
                        >
                          About {result.operator.name}
                        </Link>
                        <span className="numeric text-xs text-ink-500">
                          {result.maxSeats} seats on this run
                        </span>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
            Prices are per seat and set by each operator. You pay the driver on the day — cash or
            e-transfer, same price.
          </p>
        </>
      )}
    </div>
  );
}
