'use client';

import { useActionState } from 'react';

import { applyAsOperator } from '@/lib/operator/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function OperatorApplicationForm() {
  const [state, action] = useActionState(applyAsOperator, idleState);

  return (
    <form action={action} className="space-y-4">
      <Field label="Business name" error={fieldError(state, 'name')}>
        <Input name="name" placeholder="Your business name" required />
      </Field>

      <Field
        label="What you run"
        hint="Intercity is city-to-city. In-city is the local drop-off add-on."
        error={fieldError(state, 'type')}
      >
        <Select name="type" defaultValue="intercity">
          <option value="intercity">Intercity — between cities</option>
          <option value="incity">In-city — local drop-offs</option>
        </Select>
      </Field>

      <Field
        label="Phone number passengers can call"
        hint="Shown on your public profile."
        error={fieldError(state, 'public_phone')}
      >
        <Input name="public_phone" type="tel" required />
      </Field>

      <Field
        label="About the business (optional)"
        hint="A sentence or two. How long you have run, what your vans are like."
        error={fieldError(state, 'bio')}
      >
        <Textarea name="bio" rows={3} />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Submitting…">Apply to list</SubmitButton>
    </form>
  );
}
