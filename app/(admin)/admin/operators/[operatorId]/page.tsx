import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { setOperatorStatus } from '../../actions';
import { Badge, Button, Card, CardHeader, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatInstant } from '@/lib/time';
import type { OperatorStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Operator' };

const statusTone: Record<OperatorStatus, 'warn' | 'good' | 'bad'> = {
  pending: 'warn',
  active: 'good',
  suspended: 'bad',
};

type Member = {
  role: string;
  created_at: string;
  profile: { full_name: string | null; phone: string | null } | null;
};

export default async function AdminOperatorPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const supabase = await createClient();

  const { data: operator } = await supabase
    .from('operators')
    .select('id, name, type, bio, public_phone, status, created_at')
    .eq('id', operatorId)
    .maybeSingle();

  if (!operator) notFound();

  const [{ data: members }, { count: routeCount }, { count: departureCount }] = await Promise.all([
    supabase
      .from('operator_members')
      .select('role, created_at, profile:profiles(full_name, phone)')
      .eq('operator_id', operatorId),
    supabase
      .from('routes')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId),
    supabase
      .from('departures')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId),
  ]);

  const team = (members ?? []) as unknown as Member[];

  return (
    <>
      <PageHeader
        title={operator.name}
        description={`${operator.type === 'intercity' ? 'Intercity' : 'In-city'} operator, applied ${formatInstant(operator.created_at)}.`}
        action={
          <div className="flex items-center gap-3">
            <Badge tone={statusTone[operator.status]}>{operator.status}</Badge>
            {operator.status === 'active' ? (
              <form action={setOperatorStatus}>
                <input type="hidden" name="operator_id" value={operator.id} />
                <input type="hidden" name="status" value="suspended" />
                <Button type="submit" tone="danger">
                  Suspend
                </Button>
              </form>
            ) : (
              <form action={setOperatorStatus}>
                <input type="hidden" name="operator_id" value={operator.id} />
                <input type="hidden" name="status" value="active" />
                <Button type="submit">Activate</Button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Business details" />
          <dl className="divide-y divide-ink-100 text-sm">
            <div className="flex gap-4 px-5 py-3">
              <dt className="w-32 shrink-0 text-ink-500">Public phone</dt>
              <dd className="numeric text-ink-900">{operator.public_phone ?? 'Not given'}</dd>
            </div>
            <div className="flex gap-4 px-5 py-3">
              <dt className="w-32 shrink-0 text-ink-500">Bio</dt>
              <dd className="text-ink-900">{operator.bio ?? 'Not given'}</dd>
            </div>
            <div className="flex gap-4 px-5 py-3">
              <dt className="w-32 shrink-0 text-ink-500">Routes</dt>
              <dd className="numeric text-ink-900">{routeCount ?? 0}</dd>
            </div>
            <div className="flex gap-4 px-5 py-3">
              <dt className="w-32 shrink-0 text-ink-500">Departures</dt>
              <dd className="numeric text-ink-900">{departureCount ?? 0}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Team"
            description="Who can act for this business. Vet the owner before activating."
          />
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Phone</Th>
                <Th>Joined</Th>
              </tr>
            </thead>
            <tbody>
              {team.map((member, index) => (
                <tr key={`${member.role}-${index}`}>
                  <Td className="font-medium text-ink-900">
                    {member.profile?.full_name ?? 'Not given'}
                  </Td>
                  <Td className="capitalize">{member.role}</Td>
                  <Td className="numeric">{member.profile?.phone ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-ink-600">
                    {formatInstant(member.created_at)}
                  </Td>
                </tr>
              ))}
              {team.length === 0 ? (
                <tr>
                  <Td colSpan={4} className="text-ink-500">
                    Nobody is attached to this business yet.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
