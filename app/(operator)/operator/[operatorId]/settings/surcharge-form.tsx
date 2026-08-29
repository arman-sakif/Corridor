'use client';

import { useActionState } from 'react';

import { saveSurcharges } from '@/lib/operator/setup';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';
import { centsToInput } from '@/lib/money';

/**
 * Fixed amounts, explained in the operator's own terms. Nothing here is a
 * percentage, and nothing here can make cash and e-transfer differ.
 */
export function SurchargeForm({
  operator,
}: {
  operator: {
    id: string;
    free_luggage_per_seat: number;
    extra_luggage_cents: number;
    airport_fee_cents: number;
  };
}) {
  const [state, action] = useActionState(saveSurcharges, idleState);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="operator_id" value={operator.id} />

      <Field
        label="Bags included per seat"
        hint="Anything beyond this is charged. Two passengers travelling together get two."
        error={fieldError(state, 'free_luggage_per_seat')}
      >
        <Input
          name="free_luggage_per_seat"
          type="number"
          min={0}
          max={10}
          defaultValue={operator.free_luggage_per_seat}
          required
        />
      </Field>

      <Field
        label="Charge per extra bag"
        hint="Use 0 if you never charge for luggage."
        error={fieldError(state, 'extra_luggage')}
      >
        <Input
          name="extra_luggage"
          inputMode="decimal"
          defaultValue={centsToInput(operator.extra_luggage_cents)}
          required
        />
      </Field>

      <Field
        label="Airport fee, per seat"
        hint="Added when a trip starts or ends at a stop you have marked as an airport."
        error={fieldError(state, 'airport_fee')}
      >
        <Input
          name="airport_fee"
          inputMode="decimal"
          defaultValue={centsToInput(operator.airport_fee_cents)}
          required
        />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Saving…">Save charges</SubmitButton>

      <p className="text-xs text-ink-500">
        These apply to new bookings. A booking already taken keeps the price it was quoted.
      </p>
    </form>
  );
}
