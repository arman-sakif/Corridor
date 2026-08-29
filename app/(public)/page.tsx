import Link from 'next/link';

import { SearchForm } from '@/components/search-form';
import { createClient } from '@/lib/supabase/server';
import { todayInToronto } from '@/lib/time';

/**
 * The front door. Most people arrive here on a phone from a Kijiji link, so
 * the search box is the page — everything else is below it.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const [params, supabase] = await Promise.all([searchParams, createClient()]);

  const { data: cities } = await supabase
    .from('cities')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  return (
    <>
      <section className="border-b border-ink-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl">
            Rides between Ontario cities
          </h1>
          <p className="mt-2 text-ink-600">
            Every operator on one page. Pick a departure time, request a seat, pay the driver on
            the day.
          </p>

          <div className="mt-6">
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

      <section className="mx-auto max-w-3xl px-4 py-10">
        <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
          How it works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              step: 'Search',
              body: 'Choose your two cities and a date. You will see every operator running that day.',
            },
            {
              step: 'Request a seat',
              body: 'Pick a departure and a pickup point. The operator confirms within the hour.',
            },
            {
              step: 'Pay the driver',
              body: 'Cash or e-transfer on the day, at the same price. Nothing is charged up front.',
            },
          ].map((item) => (
            <li key={item.step} className="rounded-xl bg-white p-5 ring-1 ring-ink-200">
              <p className="font-medium text-ink-900">{item.step}</p>
              <p className="mt-1 text-sm text-ink-600">{item.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-8 text-sm text-ink-600">
          Run a rideshare business?{' '}
          <Link href="/for-operators" className="font-medium text-brand-600 hover:text-brand-700">
            List your timetable on Corridor
          </Link>
          .
        </p>
      </section>
    </>
  );
}
