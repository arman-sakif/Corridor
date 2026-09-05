import { requireOperatorRole } from '@/lib/auth/session';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { IconWallet } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { one, rows } from '@/lib/supabase/rows';
import { formatCents } from '@/lib/money';
import { formatServiceDate } from '@/lib/time';
import type { SubscriptionStatus } from '@/lib/supabase/database.types';

const tone: Record<SubscriptionStatus, 'good' | 'warn' | 'bad'> = {
  active: 'good',
  past_due: 'warn',
  cancelled: 'bad',
};

/**
 * What this business pays Corridor, and what has landed.
 *
 * `subscriptions_select_own` has permitted this since the first migration —
 * only the screen was missing, so an operator could not see their own plan,
 * their own status, or a single payment they had made. Asking someone for
 * money while showing them no record of it is not a good look.
 *
 * Read-only on purpose. Payment is collected off-platform by e-transfer and
 * recorded by an admin who has seen it arrive; an operator marking their own
 * account paid would be a claim, not a record.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ operatorId: string }>;
}) {
  const { operatorId } = await params;
  await requireOperatorRole(operatorId);

  const supabase = await createClient();
  const [subscriptionResult, paymentResult] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('plan, status, amount_cents, current_period_end')
      .eq('operator_id', operatorId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('subscription_payments')
      .select('id, amount_cents, paid_on, covers_until, note')
      .eq('operator_id', operatorId)
      .order('paid_on', { ascending: false })
      .limit(50),
  ]);

  const subscription = one(subscriptionResult, 'the subscription');
  const history = rows(paymentResult, 'the payments');

  return (
    <>
      <PageHeader
        title="Billing"
        description="What you pay for Corridor, and what we have received. Collected by e-transfer — nothing is charged automatically."
      />

      {subscription?.status === 'past_due' ? (
        <div className="mb-6">
          <Alert tone="warn">
            Your subscription is overdue. Nothing stops working and your passengers see no
            difference — but please send the next e-transfer when you can, or get in touch if
            something is wrong.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="font-semibold text-ink-900">Your plan</h2>

          {subscription ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-ink-500">Plan</dt>
                <dd className="text-ink-900 capitalize">{subscription.plan}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Amount</dt>
                <dd className="numeric text-lg font-semibold text-ink-900">
                  {formatCents(subscription.amount_cents)}
                  <span className="ml-1 text-sm font-normal text-ink-600">
                    per {subscription.plan === 'weekly' ? 'week' : 'month'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Status</dt>
                <dd>
                  <Badge tone={tone[subscription.status]}>
                    {subscription.status.replace('_', ' ')}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Paid through</dt>
                <dd className="numeric text-ink-900">
                  {subscription.current_period_end
                    ? formatServiceDate(subscription.current_period_end)
                    : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-600">
              Nothing recorded yet. Corridor sets this up when your business goes live — there is
              nothing for you to do here.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="What you have paid" />

          {history.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<IconWallet />} title="No payments recorded">
                Once an e-transfer lands, Corridor records it here. If you have sent one that is
                not showing, tell us.
              </EmptyState>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Paid</Th>
                  <Th>Amount</Th>
                  <Th>Covers until</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((payment) => (
                  <tr key={payment.id}>
                    <Td className="numeric whitespace-nowrap">
                      {formatServiceDate(payment.paid_on)}
                    </Td>
                    <Td className="numeric">{formatCents(payment.amount_cents)}</Td>
                    <Td className="numeric whitespace-nowrap">
                      {payment.covers_until ? formatServiceDate(payment.covers_until) : '—'}
                    </Td>
                    <Td className="text-ink-600">{payment.note ?? '—'}</Td>
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
