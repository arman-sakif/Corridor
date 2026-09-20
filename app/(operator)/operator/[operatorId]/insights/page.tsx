import Form from 'next/form';
import { notFound } from 'next/navigation';

import { requireOperatorRole } from '@/lib/auth/session';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { IconChart, IconSeat, IconVan, IconWallet } from '@/components/icons';
import { operatorInsights } from '@/lib/operator/queries';
import { INSIGHT_RANGES, rangeDays, type DayRow } from '@/lib/operator/insights';
import { formatCents } from '@/lib/money';
import { formatServiceDate } from '@/lib/time';
import { dynamicRoute } from '@/lib/routes';

/**
 * How the business is doing, and which days carry it.
 *
 * One measure runs through the whole page: how full the van got. Capacity is
 * per leg, so "full" is the load on a departure's busiest stretch — a van that
 * carried Windsor→London and then London→Yorkdale sold two seats and was never
 * more than a quarter full. Counting it any other way would tell an operator to
 * buy a second van.
 *
 * Everything shown is a number the operator could count by hand from their own
 * records. Nothing here is a forecast, and nothing tells them what to do.
 */
export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const [{ operatorId }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireOperatorRole(operatorId);

  // An in-city business runs no departures and sells no seats, so every
  // number on this page would be zero. Its tabs do not point here.
  if (membership.operator?.type === 'incity') notFound();

  const days = rangeDays(query.range);
  const insights = await operatorInsights(operatorId, days);
  const { totals, best, worst } = insights;

  const ranAtAll = totals.departures > 0;

  return (
    <>
      <PageHeader
        title="Insights"
        description={`How full your departures ran between ${formatServiceDate(insights.from)} and ${formatServiceDate(insights.to)}.`}
      />

      <Form
        action={dynamicRoute(`/operator/${operatorId}/insights`)}
        className="mb-6 rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink-200/70"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Period">
              <Select name="range" defaultValue={query.range ?? '30'}>
                {INSIGHT_RANGES.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit">Show</Button>
        </div>
      </Form>

      {!ranAtAll ? (
        <EmptyState icon={<IconChart />} title="Nothing has run yet">
          This fills in once your departures start going out. Put a timetable up, take a few
          bookings, and come back — there is nothing to set up here.
        </EmptyState>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Departures run"
              value={String(totals.departures)}
              detail={`${totals.fullDepartures} went out full`}
              icon={<IconVan />}
            />
            <Stat
              label="Seats sold"
              value={String(totals.passengers)}
              detail={`${totals.bookings} booking${totals.bookings === 1 ? '' : 's'}`}
              icon={<IconSeat />}
            />
            <Stat
              label="How full, on average"
              value={`${totals.occupancy}%`}
              detail={`${totals.seatsTaken} of ${totals.seatsOffered} seats, at the busiest leg`}
              icon={<IconChart />}
            />
            <Stat
              label="Fares taken"
              value={formatCents(totals.faresCents)}
              detail={
                totals.discountCents > 0
                  ? `after ${formatCents(totals.discountCents)} of voucher discounts`
                  : 'paid to your drivers on the day'
              }
              icon={<IconWallet />}
            />
          </div>

          {best && worst && best.dow !== worst.dow ? (
            <div className="mb-6">
              <Alert tone="info">
                <strong>{best.name}days</strong> are your fullest at {best.occupancy}%.{' '}
                <strong>{worst.name}days</strong> run emptiest at {worst.occupancy}% — on{' '}
                {worst.departures} departure{worst.departures === 1 ? '' : 's'}. Whether that is
                worth running is your call; this only says what happened.
              </Alert>
            </div>
          ) : null}

          <Card className="mb-6">
            <CardHeader
              title="How full the van gets, by day"
              description="The share of seats taken on each departure's busiest stretch, added up across the period."
            />
            <div className="p-5">
              <WeekdayBars days={insights.days} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="The same week, in numbers"
              description="Turned away counts requests you declined, and holds that lapsed before anyone decided."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th>Departures</Th>
                  <Th>Went out full</Th>
                  <Th>Seats sold</Th>
                  <Th>Seats offered</Th>
                  <Th>How full</Th>
                  <Th>Fares</Th>
                  <Th>Discounts</Th>
                  <Th>Turned away</Th>
                </tr>
              </thead>
              <tbody>
                {insights.days.map((day) => (
                  <Tr key={day.dow} className={day.departures === 0 ? 'text-ink-400' : undefined}>
                    <Td className="font-medium text-ink-900">{day.name}</Td>
                    <Td className="numeric">{day.departures}</Td>
                    <Td className="numeric">{day.fullDepartures}</Td>
                    <Td className="numeric">{day.passengers}</Td>
                    <Td className="numeric">{day.seatsOffered}</Td>
                    <Td className="numeric">
                      {day.departures === 0 ? '—' : `${day.occupancy}%`}
                    </Td>
                    <Td className="numeric">{formatCents(day.faresCents)}</Td>
                    <Td className="numeric">
                      {day.discountCents > 0 ? formatCents(day.discountCents) : '—'}
                    </Td>
                    <Td className="numeric">{day.turnedAway || '—'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

/**
 * One bar per weekday, one hue.
 *
 * Every number the bar encodes is written beside it, so the colour is
 * reinforcement rather than the only way to read the chart. A day with no
 * departures gets no bar and says so — an empty bar would read as "nobody
 * booked" rather than "you do not run that day".
 */
function WeekdayBars({ days }: { days: DayRow[] }) {
  return (
    <ul className="space-y-3">
      {days.map((day) => (
        <li key={day.dow} className="grid grid-cols-[3rem_1fr] items-center gap-3">
          <span className="text-sm font-medium text-ink-700">{day.name}</span>

          {day.departures === 0 ? (
            <span className="text-sm text-ink-400">No departures</span>
          ) : (
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="numeric font-medium text-ink-900">{day.occupancy}% full</span>
                <span className="numeric text-ink-500">
                  {day.seatsTaken}/{day.seatsOffered} seats · {day.departures} departure
                  {day.departures === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-100">
                <div
                  aria-hidden
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${Math.max(day.occupancy, day.seatsTaken > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-ink-200/70">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-50 text-lg text-ink-500 ring-1 ring-ink-200">
        {icon}
      </span>
      <p className="numeric mt-3 text-3xl font-semibold text-ink-900">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-ink-700">{label}</p>
      <p className="mt-1 text-xs text-ink-500">{detail}</p>
    </div>
  );
}
