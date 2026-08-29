'use client';

import { useActionState } from 'react';

import { saveVehicle } from '@/lib/operator/setup';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function VehicleForm({ operatorId }: { operatorId: string }) {
  const [state, action] = useActionState(saveVehicle, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Field label="Name" error={fieldError(state, 'label')}>
        <Input name="label" placeholder="Grey Sienna" required />
      </Field>

      <Field
        label="Passenger seats"
        hint="Not counting the driver."
        error={fieldError(state, 'seat_count')}
      >
        <Input name="seat_count" type="number" min={1} max={60} defaultValue={7} required />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Adding…">Add vehicle</SubmitButton>
    </form>
  );
}
