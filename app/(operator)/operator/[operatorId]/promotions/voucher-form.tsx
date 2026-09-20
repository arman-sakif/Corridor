'use client';

import { useActionState, useState } from 'react';

import { createVoucher } from '@/lib/promotions/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';
import { VOUCHER_WINDOWS } from '@/lib/promotions/vouchers';

/**
 * Four decisions and a button. The code itself is not one of them — it is
 * generated when this is submitted, because an operator choosing their own
 * would choose AAAAAA, and the one next door would choose it too.
 */
export function VoucherForm({ operatorId }: { operatorId: string }) {
  const [state, action] = useActionState(createVoucher, idleState);
  const [kind, setKind] = useState<'amount' | 'percent'>('amount');

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Field label="What comes off" error={fieldError(state, 'kind')}>
        <Select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as 'amount' | 'percent')}
        >
          <option value="amount">A set amount</option>
          <option value="percent">A percentage</option>
        </Select>
      </Field>

      <Field
        label={kind === 'percent' ? 'Percentage off' : 'Amount off'}
        hint={
          kind === 'percent'
            ? 'Taken off the whole fare, bags and airport fee included.'
            : 'Taken off the whole fare. A code worth more than the trip makes it free, never less than free.'
        }
        error={fieldError(state, 'value')}
      >
        <Input
          name="value"
          inputMode="decimal"
          placeholder={kind === 'percent' ? '10' : '5.00'}
          required
        />
      </Field>

      <Field
        label="Lasts for"
        hint="Counted from now. After that the code stops working on its own."
        error={fieldError(state, 'validity')}
      >
        <Select name="validity" defaultValue="7d">
          {VOUCHER_WINDOWS.map((window) => (
            <option key={window.value} value={window.value}>
              {window.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="How many bookings can use it"
        hint="One passenger can use a code once, so this is how many different people it reaches."
        error={fieldError(state, 'max_uses')}
      >
        <Input name="max_uses" type="number" min={1} max={10000} defaultValue={50} required />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Generating…">Generate code</SubmitButton>
    </form>
  );
}
