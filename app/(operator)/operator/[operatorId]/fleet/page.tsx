import { VehicleForm } from './vehicle-form';
import { setVehicleActive } from '@/lib/operator/setup';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

export default async function FleetPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, label, seat_count, is_active')
    .eq('operator_id', operatorId)
    .order('label');

  const rows = vehicles ?? [];

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Your vehicles. Passengers never see these — you use them on the day to split a departure between vans."
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Add a vehicle</h2>
          <p className="mt-1 mb-4 text-sm text-ink-600">
            Name it however you and your drivers refer to it.
          </p>
          <VehicleForm operatorId={operatorId} />
        </Card>

        <Card>
          <CardHeader title="Your vehicles" />
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No vehicles yet">
                You need at least one before you can hand a driver a passenger list.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Vehicle</Th>
                  <Th>Passenger seats</Th>
                  <Th>In service</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <Td className="font-medium text-ink-900">{vehicle.label}</Td>
                    <Td className="numeric">{vehicle.seat_count}</Td>
                    <Td>
                      {vehicle.is_active ? (
                        <Badge tone="good">Yes</Badge>
                      ) : (
                        <Badge tone="neutral">Off the road</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <form action={setVehicleActive}>
                          <input type="hidden" name="operator_id" value={operatorId} />
                          <input type="hidden" name="vehicle_id" value={vehicle.id} />
                          <input
                            type="hidden"
                            name="is_active"
                            value={vehicle.is_active ? 'false' : 'true'}
                          />
                          <Button type="submit" size="sm" tone="secondary">
                            {vehicle.is_active ? 'Take off the road' : 'Put back in service'}
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
