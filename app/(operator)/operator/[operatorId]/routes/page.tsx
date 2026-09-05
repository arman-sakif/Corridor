import Link from 'next/link';

import { RouteForm } from './route-form';
import { setRouteActive } from '@/lib/operator/setup';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';

type RouteRow = {
  id: string;
  name: string;
  pricing_mode: 'matrix' | 'additive';
  is_active: boolean;
  route_stops: { seq: number; stop: { label: string; city: { name: string } | null } | null }[];
};

export default async function RoutesPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const [stopResult, routeResult] = await Promise.all([
    supabase
      .from('stops')
      .select('id, label, city:cities(name)')
      .eq('operator_id', operatorId)
      .eq('is_active', true)
      .order('label'),
    supabase
      .from('routes')
      .select(
        'id, name, pricing_mode, is_active, route_stops(seq, stop:stops(label, city:cities(name)))',
      )
      .eq('operator_id', operatorId)
      .order('name'),
  ]);

  const routes = rows(routeResult, 'your routes') as unknown as RouteRow[];

  const stopOptions = rows(stopResult, 'your stops').map((stop) => ({
    id: stop.id,
    label: stop.city?.name ? `${stop.city.name} — ${stop.label}` : stop.label,
  }));

  return (
    <>
      <PageHeader
        title="Routes and fares"
        description="A route is the order you drive your stops, one direction. The way back is its own route."
      />

      <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Build a route</h2>
          <p className="mt-1 mb-4 text-sm text-ink-600">
            Add your stops in the order the van reaches them.
          </p>
          <RouteForm operatorId={operatorId} stops={stopOptions} />
        </Card>

        <Card>
          <CardHeader title="Your routes" />
          {routes.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No routes yet">
                Once a route exists you can set a price for every pair of stops on it.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Route</Th>
                  <Th>Stops, in order</Th>
                  <Th>Running</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => {
                  const ordered = [...route.route_stops].sort((a, b) => a.seq - b.seq);
                  return (
                    <tr key={route.id}>
                      <Td>
                        <Link
                          href={`/operator/${operatorId}/routes/${route.id}`}
                          className="font-medium text-brand-600 hover:text-brand-700"
                        >
                          {route.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {route.pricing_mode === 'matrix'
                            ? 'Each pair of stops priced separately'
                            : 'Prices add up along the route'}
                        </p>
                      </Td>
                      <Td className="text-ink-700">
                        {ordered.map((rs) => rs.stop?.city?.name ?? rs.stop?.label).join(' → ')}
                      </Td>
                      <Td>
                        {route.is_active ? (
                          <Badge tone="good">Yes</Badge>
                        ) : (
                          <Badge tone="neutral">Paused</Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/operator/${operatorId}/routes/${route.id}`}
                            className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-ink-600 hover:bg-ink-100"
                          >
                            Set fares
                          </Link>
                          <form action={setRouteActive}>
                            <input type="hidden" name="operator_id" value={operatorId} />
                            <input type="hidden" name="route_id" value={route.id} />
                            <input
                              type="hidden"
                              name="is_active"
                              value={route.is_active ? 'false' : 'true'}
                            />
                            <Button type="submit" size="sm" tone="secondary">
                              {route.is_active ? 'Pause' : 'Resume'}
                            </Button>
                          </form>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
