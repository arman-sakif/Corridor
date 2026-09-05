import Link from 'next/link';

import { Card, EmptyState, PageHeader } from '@/components/ui';
import { IconArrowRight, IconCheck, IconRoute, IconSeat, IconVan } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { count } from '@/lib/supabase/rows';
import { dynamicRoute } from '@/lib/routes';
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

  const [stopResult, routeResult, scheduleResult, vehicleResult, departureResult, pendingResult] =
    await Promise.all([
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

  const stops = count(stopResult, 'your stops');
  const routes = count(routeResult, 'your routes');
  const schedules = count(scheduleResult, 'your timetable');
  const vehicles = count(vehicleResult, 'your vehicles');
  const departures = count(departureResult, 'your departures');
  const pending = count(pendingResult, 'the seat requests waiting on you');

  const steps = [
    {
      href: `/operator/${operatorId}/stops`,
      label: 'Name your pickup points',
      done: stops >= 2,
      detail: `${stops} stop${stops === 1 ? '' : 's'}`,
      help: 'A stop is where the van actually waits — "Yorkdale Mall, by the Shoppers entrance".',
    },
    {
      href: `/operator/${operatorId}/routes`,
      label: 'Build a route and price it',
      done: routes >= 1,
      detail: `${routes} route${routes === 1 ? '' : 's'}`,
      help: 'Put your stops in the order you drive them, then set a price for each pair.',
    },
    {
      href: `/operator/${operatorId}/schedules`,
      label: 'Put it on a timetable',
      done: schedules >= 1,
      detail: `${schedules} timetable entr${schedules === 1 ? 'y' : 'ies'}`,
      help: 'Departure time, which days it runs, and how many seats.',
    },
    {
      href: `/operator/${operatorId}/fleet`,
      label: 'Add your vehicles',
      done: vehicles >= 1,
      detail: `${vehicles} vehicle${vehicles === 1 ? '' : 's'}`,
      help: 'Needed on the day, to split a busy departure across two vans.',
    },
  ];

  return (
    <>
      <PageHeader title="Overview" description="Where you are, and what is left to do." />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Seat requests waiting"
          value={pending}
          href={`/operator/${operatorId}/bookings`}
          icon={<IconSeat />}
          urgent={pending > 0}
        />
        <Stat
          label="Departures on sale"
          value={departures}
          href={`/operator/${operatorId}/departures`}
          icon={<IconVan />}
        />
        <Stat
          label="Routes"
          value={routes}
          href={`/operator/${operatorId}/routes`}
          icon={<IconRoute />}
        />
      </div>

      <Card className="p-5">
        <h2 className="font-semibold text-ink-900">Setup</h2>
        <ol className="mt-4 space-y-3">
          {steps.map((step) => (
            <li key={step.href}>
              <Link
                href={dynamicRoute(step.href)}
                className="flex items-start gap-3 rounded-lg p-3 hover:bg-ink-50"
              >
                <span
                  aria-hidden
                  className={
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ' +
                    (step.done
                      ? 'bg-good-600 text-white'
                      : 'bg-white text-transparent ring-1 ring-ink-300')
                  }
                >
                  <IconCheck strokeWidth={3} />
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

/**
 * A request waiting on the operator is the only number here with a clock on
 * it — a hold lapses in an hour — so it is the only one that gets colour.
 */
function Stat({
  label,
  value,
  href,
  icon,
  urgent = false,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ReactNode;
  urgent?: boolean;
}) {
  return (
    <Link
      href={dynamicRoute(href)}
      className={
        'group block rounded-2xl p-5 shadow-card ring-1 transition-shadow hover:shadow-raised ' +
        (urgent ? 'bg-warn-50 ring-warn-100' : 'bg-white ring-ink-200/70')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={
            'flex h-9 w-9 items-center justify-center rounded-xl text-lg ring-1 ' +
            (urgent
              ? 'bg-white text-warn-700 ring-warn-100'
              : 'bg-ink-50 text-ink-500 ring-ink-200')
          }
        >
          {icon}
        </span>
        <IconArrowRight
          className={
            'mt-2 text-sm transition-transform group-hover:translate-x-0.5 ' +
            (urgent ? 'text-warn-600' : 'text-ink-300')
          }
        />
      </div>
      <p className={'numeric mt-3 text-3xl font-semibold ' + (urgent ? 'text-warn-700' : 'text-ink-900')}>
        {value}
      </p>
      <p className={'mt-0.5 text-sm ' + (urgent ? 'text-warn-700' : 'text-ink-600')}>{label}</p>
    </Link>
  );
}
