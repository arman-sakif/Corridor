import { notFound } from 'next/navigation';

import { OperatorSettingsForm } from './settings-form';
import { SurchargeForm } from './surcharge-form';
import { requireOperatorRole } from '@/lib/auth/session';
import { Alert, Card, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { one } from '@/lib/supabase/rows';

export default async function OperatorSettingsPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  const { membership } = await requireOperatorRole(operatorId);

  const supabase = await createClient();
  const operator = one(
    await supabase
      .from('operators')
      .select(
        'id, name, bio, public_phone, status, type, free_luggage_per_seat, extra_luggage_cents, airport_fee_cents',
      )
      .eq('id', operatorId)
      .maybeSingle(),
    'your business details',
  );

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

        {membership.role === 'owner' ? (
          <Card className="p-6">
            <h2 className="font-semibold text-ink-900">Luggage and airport charges</h2>
            <p className="mt-1 mb-5 text-sm text-ink-600">
              Fixed amounts on top of the fare. Cash and e-transfer cost the same either way.
            </p>
            <SurchargeForm operator={operator} />
          </Card>
        ) : null}

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
