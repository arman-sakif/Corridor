import type { Metadata } from 'next';
import Link from 'next/link';

import { SearchForm } from '@/components/search-form';
import { Badge, ButtonLink, Card, EmptyState } from '@/components/ui';
import { searchDepartures } from '@/lib/booking/search';
import { createClient } from '@/lib/supabase/server';
import { dynamicRoute } from '@/lib/routes';
import { formatCents } from '@/lib/money';
import { addDays, formatServiceDateLong, formatTime, isValidServiceDate, todayInToronto } from '@/lib/time';

export const metadata: Metadata = { title: 'Search' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: cities } = await supabase
    .from('cities')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  const cityName = new Map((cities ?? []).map((city) => [city.id, city.name]));
  const today = todayInToronto();
  const date = params.date && isValidServiceDate(params.date) ? params.date : today;

  const ready = Boolean(params.from && params.to && params.from !== params.to);
  const results = ready
    ? await searchDepartures({ fromCityId: params.from!, toCityId: params.to!, date })
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <SearchForm
        cities={cities ?? []}
        defaults={{ from: params.from ?? '', to: params.to ?? '', date }}
      />

      {!ready ? (
        <div className="mt-8">
          <EmptyState title="Choose where you are going">
            Pick the city you are leaving from and the city you are heading to.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-8 mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-lg font-semibold text-ink-900">
              {cityName.get(params.from!) ?? 'Origin'} to {cityName.get(params.to!) ?? 'Destination'}
            </h1>
            <p className="text-sm text-ink-600">{formatServiceDateLong(date)}</p>
          </div>

          {results.length === 0 ? (
            <EmptyState
              title="Nothing running that day"
              action={
                <div className="flex gap-2">
                  <ButtonLink
                    href={dynamicRoute(`/search?from=${params.from}&to=${params.to}&date=${addDays(date, 1)}`)}
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
              {results.map((result) => (
                <li key={result.departureId}>
                  <Card className="p-4 transition-shadow hover:shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="numeric text-2xl font-semibold text-ink-900">
                          {formatTime(result.departureTime)}
                        </p>
                        <p className="mt-0.5 font-medium text-ink-800">{result.operator.name}</p>
                        <p className="mt-1 text-sm text-ink-600">
                          Leaves from {result.boardings[0]?.fromStopLabel}
                          {result.boardings.length > 1
                            ? ` or ${result.boardings.length - 1} other pickup point${
                                result.boardings.length > 2 ? 's' : ''
                              }`
                            : ''}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="numeric text-xl font-semibold text-ink-900">
                          {formatCents(result.fromCents)}
                        </p>
                        <p className="text-xs text-ink-500">per seat</p>
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

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
                      <Link
                        href={`/operators/${result.operator.id}`}
                        className="text-sm text-ink-600 hover:text-ink-900"
                      >
                        About {result.operator.name}
                      </Link>
                      <ButtonLink
                        href={dynamicRoute(`/departures/${result.departureId}?from=${params.from}&to=${params.to}`)}
                      >
                        Choose this one
                      </ButtonLink>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-6 text-center text-xs text-ink-500">
            Prices are per seat and set by each operator. You pay the driver on the day — cash or
            e-transfer, same price.
          </p>
        </>
      )}
    </div>
  );
}
