'use client';

import { useActionState } from 'react';

import { saveStop } from '@/lib/operator/setup';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function StopForm({
  operatorId,
  cities,
}: {
  operatorId: string;
  cities: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveStop, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Field label="City" error={fieldError(state, 'city_id')}>
        <Select name="city_id" required defaultValue="">
          <option value="" disabled>
            Choose a city
          </option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Pickup point" error={fieldError(state, 'label')}>
        <Input name="label" placeholder="Yorkdale Mall" required />
      </Field>

      <Field
        label="Where exactly (optional)"
        hint="The door, the corner, the row of the car park."
        error={fieldError(state, 'description')}
      >
        <Textarea name="description" rows={2} placeholder="By the Shoppers Drug Mart entrance" />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Adding…">Add stop</SubmitButton>

      {cities.length === 0 ? (
        <p className="text-sm text-ink-500">
          No cities are available yet. Corridor adds those — get in touch and we will add yours.
        </p>
      ) : null}
    </form>
  );
}
