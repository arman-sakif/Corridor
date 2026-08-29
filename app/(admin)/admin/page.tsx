import type { Metadata } from 'next';
import Link from 'next/link';

import { setOperatorStatus } from './actions';
import { Badge, Button, Card, CardHeader, EmptyState, Table, Td, Th } from '@/components/ui';
import { PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatInstant } from '@/lib/time';
import type { OperatorStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Operators' };

const statusTone: Record<OperatorStatus, 'warn' | 'good' | 'bad'> = {
  pending: 'warn',
  active: 'good',
  suspended: 'bad',
};

export default async function AdminOperatorsPage() {
  const supabase = await createClient();

  const { data: operators } = await supabase
    .from('operators')
    .select('id, name, type, public_phone, status, created_at, bio')
    .order('created_at', { ascending: false });

  const rows = operators ?? [];
  const pending = rows.filter((o) => o.status === 'pending');
  const rest = rows.filter((o) => o.status !== 'pending');

  return (
    <>
      <PageHeader
        title="Operators"
        description="A business stays invisible to passengers until you activate it."
      />

      <Card className="mb-8">
        <CardHeader
          title="Waiting to be vetted"
          description="Check the business is real and licensed before you activate it."
        />
        {pending.length === 0 ? (
          <div className="p-5">
            <EmptyState title="Nothing waiting">
              New signups land here. There are none right now.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Type</Th>
                <Th>Phone</Th>
                <Th>Applied</Th>
                <Th className="text-right">Decision</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((operator) => (
                <tr key={operator.id}>
                  <Td>
                    <Link
                      href={`/admin/operators/${operator.id}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {operator.name}
                    </Link>
                    {operator.bio ? (
                      <p className="mt-0.5 max-w-md text-xs text-ink-500">{operator.bio}</p>
                    ) : null}
                  </Td>
                  <Td className="capitalize">{operator.type}</Td>
                  <Td className="numeric">{operator.public_phone ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-ink-600">
                    {formatInstant(operator.created_at)}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <form action={setOperatorStatus}>
                        <input type="hidden" name="operator_id" value={operator.id} />
                        <input type="hidden" name="status" value="active" />
                        <Button type="submit" size="sm">
                          Activate
                        </Button>
                      </form>
                      <form action={setOperatorStatus}>
                        <input type="hidden" name="operator_id" value={operator.id} />
                        <input type="hidden" name="status" value="suspended" />
                        <Button type="submit" size="sm" tone="danger">
                          Reject
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

      <Card>
        <CardHeader title="All operators" />
        {rest.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No operators yet">
              Once you activate a business, it appears here and in passenger search.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Phone</Th>
                <Th className="text-right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {rest.map((operator) => (
                <tr key={operator.id}>
                  <Td>
                    <Link
                      href={`/admin/operators/${operator.id}`}
                      className="font-medium text-brand-600 hover:text-brand-700"
                    >
                      {operator.name}
                    </Link>
                  </Td>
                  <Td className="capitalize">{operator.type}</Td>
                  <Td>
                    <Badge tone={statusTone[operator.status]}>{operator.status}</Badge>
                  </Td>
                  <Td className="numeric">{operator.public_phone ?? '—'}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      {operator.status === 'active' ? (
                        <form action={setOperatorStatus}>
                          <input type="hidden" name="operator_id" value={operator.id} />
                          <input type="hidden" name="status" value="suspended" />
                          <Button type="submit" size="sm" tone="danger">
                            Suspend
                          </Button>
                        </form>
                      ) : (
                        <form action={setOperatorStatus}>
                          <input type="hidden" name="operator_id" value={operator.id} />
                          <input type="hidden" name="status" value="active" />
                          <Button type="submit" size="sm" tone="secondary">
                            Reinstate
                          </Button>
                        </form>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
