import { StopForm } from './stop-form';
import { setStopActive } from '@/lib/operator/setup';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';

export default async function StopsPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const [cityResult, stopResult] = await Promise.all([
    supabase.from('cities').select('id, name').eq('is_active', true).order('name'),
    supabase
      .from('stops')
      .select('id, label, description, is_active, is_airport, city:cities(id, name)')
      .eq('operator_id', operatorId)
      .order('label'),
  ]);

  const cities = rows(cityResult, 'the city list');
  const stops = rows(stopResult, 'your stops');

  return (
    <>
      <PageHeader
        title="Stops"
        description="The exact places you pick up and drop off. Passengers choose one of these, not an address."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Add a stop</h2>
          <p className="mt-1 mb-4 text-sm text-ink-600">
            Be specific enough that a passenger standing there knows they are in the right place.
          </p>
          <StopForm operatorId={operatorId} cities={cities} />
        </Card>

        <Card>
          <CardHeader title="Your stops" />
          {stops.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No stops yet">
                Start with the two ends of your run — where you leave from and where you finish.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>City</Th>
                  <Th>Pickup point</Th>
                  <Th>In use</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => (
                  <tr key={stop.id}>
                    <Td className="whitespace-nowrap font-medium text-ink-900">
                      {stop.city?.name}
                    </Td>
                    <Td>
                      <span className="font-medium text-ink-900">{stop.label}</span>
                      {stop.is_airport ? (
                        <span className="ml-2 align-middle">
                          <Badge tone="brand">Airport</Badge>
                        </span>
                      ) : null}
                      {stop.description ? (
                        <p className="mt-0.5 text-xs text-ink-500">{stop.description}</p>
                      ) : null}
                    </Td>
                    <Td>
                      {stop.is_active ? (
                        <Badge tone="good">Yes</Badge>
                      ) : (
                        <Badge tone="neutral">Retired</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <form action={setStopActive}>
                          <input type="hidden" name="operator_id" value={operatorId} />
                          <input type="hidden" name="stop_id" value={stop.id} />
                          <input
                            type="hidden"
                            name="is_active"
                            value={stop.is_active ? 'false' : 'true'}
                          />
                          <Button type="submit" size="sm" tone="secondary">
                            {stop.is_active ? 'Retire' : 'Use again'}
                          </Button>
                        </form>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
