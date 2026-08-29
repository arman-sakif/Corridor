import Link from 'next/link';

import { Card, EmptyState, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { todayInToronto } from '@/lib/time';

/**
 * A checklist, not a chart. A new operator's question is "what do I still have
 * to do before passengers can book?", so the overview answers exactly that.
 */
export default async function OperatorOverviewPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();
  const today = todayInToronto();

  const [stops, routes, schedules, vehicles, departures, pending] = await Promise.all([
    supabase.from('stops').select('id', { count: 'exact', head: true }).eq('operator_id', operatorId),
    supabase.from('routes').select('id', { count: 'exact', head: true }).eq('operator_id', operatorId),
    supabase
      .from('schedules')
      .select('id, routes!inner(operator_id)', { count: 'exact', head: true })
      .eq('routes.operator_id', operatorId),
    supabase
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId),
    supabase
      .from('departures')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId)
      .gte('service_date', today),
    supabase
      .from('bookings')
      .select('id, departures!inner(operator_id)', { count: 'exact', head: true })
      .eq('departures.operator_id', operatorId)
      .eq('status', 'held'),
  ]);

  const steps = [
    {
      href: `/operator/${operatorId}/stops`,
      label: 'Name your pickup points',
      done: (stops.count ?? 0) >= 2,
      detail: `${stops.count ?? 0} stop${stops.count === 1 ? '' : 's'}`,
      help: 'A stop is where the van actually waits — "Yorkdale Mall, by the Shoppers entrance".',
    },
    {
      href: `/operator/${operatorId}/routes`,
      label: 'Build a route and price it',
      done: (routes.count ?? 0) >= 1,
      detail: `${routes.count ?? 0} route${routes.count === 1 ? '' : 's'}`,
      help: 'Put your stops in the order you drive them, then set a price for each pair.',
    },
    {
      href: `/operator/${operatorId}/schedules`,
      label: 'Put it on a timetable',
      done: (schedules.count ?? 0) >= 1,
      detail: `${schedules.count ?? 0} timetable entr${schedules.count === 1 ? 'y' : 'ies'}`,
      help: 'Departure time, which days it runs, and how many seats.',
    },
    {
      href: `/operator/${operatorId}/fleet`,
      label: 'Add your vehicles',
      done: (vehicles.count ?? 0) >= 1,
      detail: `${vehicles.count ?? 0} vehicle${vehicles.count === 1 ? '' : 's'}`,
      help: 'Needed on the day, to split a busy departure across two vans.',
    },
  ];

  return (
    <>
      <PageHeader title="Overview" description="Where you are, and what is left to do." />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Seat requests waiting" value={pending.count ?? 0} href={`/operator/${operatorId}/bookings`} />
        <Stat label="Departures on sale" value={departures.count ?? 0} href={`/operator/${operatorId}/departures`} />
        <Stat label="Routes" value={routes.count ?? 0} href={`/operator/${operatorId}/routes`} />
      </div>

      <Card className="p-5">
        <h2 className="font-semibold text-ink-900">Setup</h2>
        <ol className="mt-4 space-y-3">
          {steps.map((step) => (
            <li key={step.href}>
              <Link
                href={step.href}
                className="flex items-start gap-3 rounded-lg p-3 hover:bg-ink-50"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    step.done ? 'bg-good-100 text-good-700' : 'bg-ink-200 text-ink-500'
                  }`}
                >
                  {step.done ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-ink-900">
                    {step.label}
                    <span className="ml-2 text-xs font-normal text-ink-500">{step.detail}</span>
                  </span>
                  <span className="block text-sm text-ink-600">{step.help}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        {steps.every((step) => step.done) ? null : (
          <div className="mt-4">
            <EmptyState title="Work top to bottom">
              Each step needs the one above it. Stops make routes, routes make a timetable, and the
              timetable puts departures on sale.
            </EmptyState>
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl bg-white p-5 ring-1 ring-ink-200 transition-shadow hover:shadow-sm"
    >
      <p className="text-sm text-ink-600">{label}</p>
      <p className="numeric mt-1 text-3xl font-semibold text-ink-900">{value}</p>
    </Link>
  );
}
