import Link from 'next/link';

import { SearchForm } from '@/components/search-form';
import { Card } from '@/components/ui';
import { IconArrowRight, IconRoute, IconSeat, IconWallet } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { todayInToronto } from '@/lib/time';

/**
 * The front door. Most people arrive here on a phone from a Kijiji link, so
 * the search box is the page — everything else sits below the fold and exists
 * to answer "is this legitimate?" rather than to sell anything.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const [params, supabase] = await Promise.all([searchParams, createClient()]);

  const [{ data: cities }, { count: operatorCount }] = await Promise.all([
    supabase.from('cities').select('id, name').eq('is_active', true).order('name'),
    supabase.from('operators').select('id', { count: 'exact', head: true }),
  ]);

  return (
    <>
      <section className="hero-grid relative overflow-hidden border-b border-ink-200 bg-white">
        {/* A wash of brand colour behind the hero rather than a flat slab. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-80 bg-[radial-gradient(ellipse_at_top,var(--color-brand-100),transparent_70%)] opacity-70"
        />

        <div className="relative mx-auto max-w-3xl px-4 py-12 sm:py-16">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-100 ring-inset">
            <IconRoute className="text-sm" />
            Windsor · Chatham · London · Mississauga · Toronto
          </p>

          <h1 className="display text-4xl font-semibold text-ink-900 sm:text-5xl">
            Rides between Ontario cities
          </h1>
          <p className="mt-3 max-w-xl text-lg text-ink-600">
            Every operator on one page. Pick a departure time, request a seat, and pay the driver
            on the day.
          </p>

          <div className="mt-7">
            <SearchForm
              cities={cities ?? []}
              defaults={{
                from: params.from ?? '',
                to: params.to ?? '',
                date: params.date ?? todayInToronto(),
              }}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="text-xs font-semibold tracking-wider text-ink-500 uppercase">
          How it works
        </h2>

        <ol className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            {
              Icon: IconRoute,
              step: 'Search',
              body: 'Choose your two cities and a date. You will see every operator running that day, side by side.',
            },
            {
              Icon: IconSeat,
              step: 'Request a seat',
              body: 'Pick a departure and a pickup point. The operator confirms within the hour.',
            },
            {
              Icon: IconWallet,
              step: 'Pay the driver',
              body: 'Cash or e-transfer on the day, at the same price. Nothing is charged up front.',
            },
          ].map(({ Icon, step, body }, index) => (
            <li key={step}>
              <Card className="h-full p-5 transition-shadow hover:shadow-raised">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-lg text-brand-600 ring-1 ring-brand-100">
                    <Icon />
                  </span>
                  <span className="numeric text-xs font-semibold text-ink-400">
                    0{index + 1}
                  </span>
                </div>
                <p className="mt-3 font-semibold text-ink-900">{step}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{body}</p>
              </Card>
            </li>
          ))}
        </ol>

        <Card className="mt-8 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
            <div className="min-w-0">
              <p className="font-semibold text-ink-900">Run a rideshare business?</p>
              <p className="mt-1 text-sm text-ink-600">
                Put your timetable online and stop taking bookings by text.
                {operatorCount ? (
                  <>
                    {' '}
                    <span className="numeric font-medium text-ink-800">{operatorCount}</span>{' '}
                    {operatorCount === 1 ? 'operator is' : 'operators are'} already listed.
                  </>
                ) : null}
              </p>
            </div>
            <Link
              href="/for-operators"
              className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
            >
              List your business
              <IconArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Card>
      </section>
    </>
  );
}
