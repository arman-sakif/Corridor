import { notFound } from 'next/navigation';

import { OperatorSettingsForm } from './settings-form';
import { requireOperatorRole } from '@/lib/auth/session';
import { Alert, Card, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

export default async function OperatorSettingsPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const { membership } = await requireOperatorRole(operatorId);

  const supabase = await createClient();
  const { data: operator } = await supabase
    .from('operators')
    .select('id, name, bio, public_phone, status, type')
    .eq('id', operatorId)
    .maybeSingle();

  if (!operator) notFound();

  return (
    <>
      <PageHeader
        title="Business details"
        description="What passengers see on your profile page."
      />

      <div className="max-w-2xl space-y-6">
        {membership.role === 'owner' ? (
          <Card className="p-6">
            <OperatorSettingsForm operator={operator} />
          </Card>
        ) : (
          <Alert tone="info">Only an owner can change these details.</Alert>
        )}

        <Card className="p-6">
          <h2 className="font-semibold text-ink-900">Listing status</h2>
          <p className="mt-2 text-sm text-ink-600">
            {operator.status === 'active'
              ? 'Your departures appear in passenger search.'
              : operator.status === 'pending'
                ? 'Corridor is still checking your business. Nothing you do here is lost — the moment you are vetted, your departures go on sale.'
                : 'Your listing is suspended and passengers cannot see it. Get in touch to sort it out.'}
          </p>
          <p className="mt-3 text-sm text-ink-500">
            Activating and suspending is Corridor’s decision, not something you can change here.
          </p>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-ink-900">Licensing and insurance</h2>
          <p className="mt-2 text-sm text-ink-600">
            Corridor is booking software. Ontario licensing and commercial passenger insurance are
            yours to hold and yours to keep current — we do not carry them for you.
          </p>
        </Card>
      </div>
    </>
  );
}
