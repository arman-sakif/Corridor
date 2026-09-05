import { ScheduleForm } from './schedule-form';
import { setScheduleActive } from '@/lib/operator/setup';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { formatDaysOfWeek, formatServiceDate, formatTime } from '@/lib/time';

export default async function SchedulesPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const routes = rows(
    await supabase
      .from('routes')
      .select('id, name, is_active, route_stops(id)')
      .eq('operator_id', operatorId)
      .order('name'),
    'your routes',
  );

  const routeIds = routes.map((route) => route.id);

  const schedules = routeIds.length
    ? rows(
        await supabase
          .from('schedules')
          .select(
            'id, route_id, departure_time, days_of_week, max_seats, active_from, active_to, is_active',
          )
          .in('route_id', routeIds)
          .order('departure_time'),
        'your timetable',
      )
    : [];

  const nameOf = new Map(routes.map((route) => [route.id, route.name]));
  const bookable = routes.filter((route) => (route.route_stops ?? []).length >= 2);

  return (
    <>
      <PageHeader
        title="Timetable"
        description="When each route runs. Departures for the next 30 days are put on sale automatically."
      />

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Add a departure time</h2>
          <p className="mt-1 mb-4 text-sm text-ink-600">
            One entry covers every day it runs — you do not add each date by hand.
          </p>
          <ScheduleForm operatorId={operatorId} routes={bookable} />
        </Card>

        <Card>
          <CardHeader title="Running now" />
          {schedules.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Nothing on the timetable">
                Add your first departure time and passengers can start booking it.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Route</Th>
                  <Th>Leaves</Th>
                  <Th>Days</Th>
                  <Th>Seats</Th>
                  <Th>From</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <Td className="font-medium text-ink-900">
                      {nameOf.get(schedule.route_id) ?? 'Route'}
                    </Td>
                    <Td className="numeric whitespace-nowrap">
                      {formatTime(schedule.departure_time)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDaysOfWeek(schedule.days_of_week)}
                    </Td>
                    <Td className="numeric">{schedule.max_seats}</Td>
                    <Td className="numeric whitespace-nowrap text-ink-600">
                      {formatServiceDate(schedule.active_from)}
                      {schedule.active_to ? ` – ${formatServiceDate(schedule.active_to)}` : ''}
                    </Td>
                    <Td>
                      <div className="flex items-center justify-end gap-2">
                        {schedule.is_active ? (
                          <Badge tone="good">On sale</Badge>
                        ) : (
                          <Badge tone="neutral">Stopped</Badge>
                        )}
                        <form action={setScheduleActive}>
                          <input type="hidden" name="operator_id" value={operatorId} />
                          <input type="hidden" name="schedule_id" value={schedule.id} />
                          <input
                            type="hidden"
                            name="is_active"
                            value={schedule.is_active ? 'false' : 'true'}
                          />
                          <Button type="submit" size="sm" tone="secondary">
                            {schedule.is_active ? 'Stop' : 'Start'}
                          </Button>
                        </form>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
            Stopping a timetable entry keeps departures already on sale. Cancel those one by one
            from the Departures tab if you need to.
          </p>
        </Card>
      </div>
    </>
  );
}
