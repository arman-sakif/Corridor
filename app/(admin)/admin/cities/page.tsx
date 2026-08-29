import type { Metadata } from 'next';

import { CityForm } from './city-form';
import { setCityActive } from '../actions';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Cities' };

export default async function AdminCitiesPage() {
  const supabase = await createClient();

  // The admin client is not needed: cities_admin_all lets an admin read
  // inactive rows that the public policy hides.
  const { data: cities } = await supabase
    .from('cities')
    .select('id, name, province, is_active')
    .order('name');

  const rows = cities ?? [];

  return (
    <>
      <PageHeader
        title="Cities"
        description="Passengers search between cities. Operators name their own stops inside them."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Add a city</h2>
          <p className="mt-1 mb-4 text-sm text-ink-600">
            Only add a city an operator actually serves — an empty city returns no rides.
          </p>
          <CityForm />
        </Card>

        <Card>
          <CardHeader title="On the list" />
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No cities yet">
                Add Toronto and Windsor first — that is the corridor most operators run.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>City</Th>
                  <Th>Province</Th>
                  <Th>Searchable</Th>
                  <Th className="text-right">Change</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((city) => (
                  <tr key={city.id}>
                    <Td className="font-medium text-ink-900">{city.name}</Td>
                    <Td>{city.province}</Td>
                    <Td>
                      {city.is_active ? (
                        <Badge tone="good">Yes</Badge>
                      ) : (
                        <Badge tone="neutral">Hidden</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        <form action={setCityActive}>
                          <input type="hidden" name="city_id" value={city.id} />
                          <input
                            type="hidden"
                            name="is_active"
                            value={city.is_active ? 'false' : 'true'}
                          />
                          <Button type="submit" size="sm" tone="secondary">
                            {city.is_active ? 'Hide from search' : 'Show in search'}
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
