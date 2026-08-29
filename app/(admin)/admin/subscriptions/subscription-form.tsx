'use client';

import { useActionState } from 'react';

import { saveSubscription } from '../actions';
import { SubmitButton } from '@/components/form';
import { Input, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';
import type { SubscriptionPlan, SubscriptionStatus } from '@/lib/supabase/database.types';

/**
 * A one-line inline form per operator. The admin is reconciling a list of
 * e-transfers, so the fewest possible clicks per row matters more than a
 * pretty modal.
 */
export function SubscriptionForm({
  operatorId,
  current,
}: {
  operatorId: string;
  current: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    current_period_end: string | null;
  } | null;
}) {
  const [state, action] = useActionState(saveSubscription, idleState);

  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Select name="plan" defaultValue={current?.plan ?? 'monthly'} className="w-28">
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </Select>

      <Select name="status" defaultValue={current?.status ?? 'active'} className="w-32">
        <option value="active">Active</option>
        <option value="past_due">Past due</option>
        <option value="cancelled">Cancelled</option>
      </Select>

      <Input
        type="date"
        name="current_period_end"
        defaultValue={current?.current_period_end ?? ''}
        className="w-40"
        aria-label="Paid through"
      />

      <SubmitButton size="sm" tone="secondary" pendingLabel="Saving…">
        Save
      </SubmitButton>

      {state.status === 'error' ? (
        <span className="w-full text-right text-xs text-bad-700">{state.message}</span>
      ) : null}
    </form>
  );
}
