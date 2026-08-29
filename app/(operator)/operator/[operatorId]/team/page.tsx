import { TeamForm } from './team-form';
import { removeTeamMember } from '@/lib/operator/actions';
import { requireOperatorRole } from '@/lib/auth/session';
import { Badge, Button, Card, CardHeader, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

type Member = {
  id: string;
  role: 'owner' | 'staff' | 'driver';
  user_id: string;
  profile: { full_name: string | null; phone: string | null } | null;
};

const roleBlurb = {
  owner: 'Everything, including the team and business details.',
  staff: 'Routes, fares, timetable, and approving seat requests.',
  driver: 'Their own departures and passenger lists. Nothing else.',
} as const;

export default async function TeamPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const { membership } = await requireOperatorRole(operatorId);
  const isOwner = membership.role === 'owner';

  const supabase = await createClient();
  const { data } = await supabase
    .from('operator_members')
    .select('id, role, user_id, profile:profiles(full_name, phone)')
    .eq('operator_id', operatorId);

  const members = (data ?? []) as unknown as Member[];
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can act for this business, and how much they can do."
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {isOwner ? (
          <Card className="h-fit p-5">
            <h2 className="font-semibold text-ink-900">Add someone</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600">
              They need a Corridor account first. Ask them to sign up, then add the email address
              they used.
            </p>
            <TeamForm operatorId={operatorId} />
          </Card>
        ) : (
          <Card className="h-fit p-5">
            <h2 className="font-semibold text-ink-900">Adding people</h2>
            <p className="mt-1 text-sm text-ink-600">
              Only an owner can change the team. Ask one of them.
            </p>
          </Card>
        )}

        <Card>
          <CardHeader title="On the team" />
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Can do</Th>
                {isOwner ? <Th className="text-right">Change</Th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <Td className="font-medium text-ink-900">
                    {member.profile?.full_name ?? 'Not filled in yet'}
                  </Td>
                  <Td className="numeric">{member.profile?.phone ?? '—'}</Td>
                  <Td>
                    <Badge tone={member.role === 'driver' ? 'neutral' : 'brand'}>
                      {member.role}
                    </Badge>
                    <p className="mt-0.5 text-xs text-ink-500">{roleBlurb[member.role]}</p>
                  </Td>
                  {isOwner ? (
                    <Td>
                      <div className="flex justify-end">
                        {member.role === 'owner' && ownerCount <= 1 ? (
                          <span className="text-xs text-ink-500">Last owner</span>
                        ) : (
                          <form action={removeTeamMember}>
                            <input type="hidden" name="operator_id" value={operatorId} />
                            <input type="hidden" name="member_id" value={member.id} />
                            <Button type="submit" size="sm" tone="danger">
                              Remove
                            </Button>
                          </form>
                        )}
                      </div>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
