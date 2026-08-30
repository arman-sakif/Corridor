'use client';

import { useActionState } from 'react';

import { saveZone } from '@/lib/incity/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function ZoneForm({ operatorId }: { operatorId: string }) {
  const [state, action] = useActionState(saveZone, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Field
        label="Area"
        hint="What a passenger would call it — the name has to be recognisable without a map."
        error={fieldError(state, 'name')}
      >
        <Input name="name" placeholder="North York" required />
      </Field>

      <Field
        label="Price"
        hint="One flat fare for anywhere in this area, whatever the address. Enter 0 if it is free."
        error={fieldError(state, 'price')}
      >
        <Input name="price" inputMode="decimal" placeholder="18.00" required />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ring-ink-200 has-checked:bg-brand-50 has-checked:ring-brand-500">
        <input type="checkbox" name="is_active" defaultChecked className="mt-0.5" />
        <span className="text-sm">
          <span className="block font-medium text-ink-900">Take bookings for this area</span>
          <span className="mt-0.5 block text-ink-600">
            Turn it off to stop selling it without losing the rides already booked.
          </span>
        </span>
      </label>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Adding…">Add area</SubmitButton>
    </form>
  );
}
