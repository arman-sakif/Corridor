import { notFound } from 'next/navigation';

import { ZoneForm } from './zone-form';
import { toggleZone } from '@/lib/incity/actions';
import { requireOperatorRole } from '@/lib/auth/session';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { IconPin } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { formatCents } from '@/lib/money';

/**
 * The areas an in-city operator sells, and what each costs.
 *
 * One flat price per named area, whatever the address inside it — there are no
 * coordinates anywhere in this product, so a zone is a name and a number and
 * the driver reads the address the passenger typed.
 */
export default async function ZonesPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const { membership } = await requireOperatorRole(operatorId);

  // Zones belong to in-city businesses. An intercity operator reaching this
  // URL has no use for it and no tab pointing here.
  if (membership.operator?.type !== 'incity') notFound();

  const supabase = await createClient();
  const zones = rows(
    await supabase
      .from('incity_zones')
      .select('id, name, flat_price_cents, is_active')
      .eq('operator_id', operatorId)
      .order('flat_price_cents'),
    'your zones',
  );

  return (
    <>
      <PageHeader
        title="Zones"
        description="The areas you drop off in, and the flat fare for each. Passengers pick an area and type their address."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Add an area</h2>
          <p className="mt-1 mb-4 text-sm text-ink-600">
            One price covers the whole area. Somewhere further out is a separate area at a higher
            price.
          </p>
          <ZoneForm operatorId={operatorId} />
        </Card>

        <Card>
          <CardHeader title="Where you go" />

          {zones.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<IconPin />} title="No areas yet">
                Add the parts of town you drive to. Passengers cannot book a local ride until at
                least one is on sale.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Area</Th>
                  <Th>Fare</Th>
                  <Th>On sale</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.id}>
                    <Td className="font-medium text-ink-900">{zone.name}</Td>
                    <Td className="numeric">{formatCents(zone.flat_price_cents)}</Td>
                    <Td>
                      {zone.is_active ? (
                        <Badge tone="good">On sale</Badge>
                      ) : (
                        <Badge tone="neutral">Paused</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <form action={toggleZone}>
                          <input type="hidden" name="operator_id" value={operatorId} />
                          <input type="hidden" name="zone_id" value={zone.id} />
                          <Button type="submit" size="sm" tone="secondary">
                            {zone.is_active ? 'Pause' : 'Put on sale'}
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
