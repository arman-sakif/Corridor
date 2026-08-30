import type { Metadata } from 'next';

import { SubscriptionForm } from './subscription-form';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/money';
import { formatServiceDate } from '@/lib/time';
import type { SubscriptionStatus } from '@/lib/supabase/database.types';

export const metadata: Metadata = { title: 'Subscriptions' };

const tone: Record<SubscriptionStatus, 'good' | 'warn' | 'bad'> = {
  active: 'good',
  past_due: 'warn',
  cancelled: 'bad',
};

export default async function AdminSubscriptionsPage() {
  const supabase = await createClient();

  const [{ data: operators }, { data: subscriptions }] = await Promise.all([
    supabase.from('operators').select('id, name, status').order('name'),
    supabase
      .from('subscriptions')
      .select('id, operator_id, plan, status, amount_cents, current_period_end, updated_at')
      // Overdue first — the reason to open this page is to find who has not
      // paid, and sorting by when a row was last touched buries exactly them.
      .order('status', { ascending: true })
      .order('updated_at', { ascending: false }),
  ]);

  const byOperator = new Map((subscriptions ?? []).map((s) => [s.operator_id, s]));
  const rows = operators ?? [];

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Payment is collected off-platform by e-transfer. This is the record of what has landed."
      />

      <Card>
        <CardHeader title="Per operator" />
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No operators yet">
              Activate a business first, then record what it is paying.
            </EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Plan</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Paid through</Th>
                <Th className="text-right">Record a payment</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((operator) => {
                const subscription = byOperator.get(operator.id);
                return (
                  <tr key={operator.id}>
                    <Td className="font-medium text-ink-900">{operator.name}</Td>
                    <Td className="capitalize">{subscription?.plan ?? '—'}</Td>
                    <Td className="numeric">
                      {subscription ? formatCents(subscription.amount_cents) : '—'}
                    </Td>
                    <Td>
                      {subscription ? (
                        <Badge tone={tone[subscription.status]}>
                          {subscription.status.replace('_', ' ')}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">none</Badge>
                      )}
                    </Td>
                    <Td className="numeric whitespace-nowrap">
                      {subscription?.current_period_end
                        ? formatServiceDate(subscription.current_period_end)
                        : '—'}
                    </Td>
                    <Td>
                      <SubscriptionForm
                        operatorId={operator.id}
                        current={
                          subscription
                            ? {
                                plan: subscription.plan,
                                status: subscription.status,
                                amount_cents: subscription.amount_cents,
                                current_period_end: subscription.current_period_end,
                              }
                            : null
                        }
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
