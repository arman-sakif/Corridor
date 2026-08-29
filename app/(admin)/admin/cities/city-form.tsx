'use client';

import { useActionState } from 'react';

import { createCity } from '../actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function CityForm() {
  const [state, action] = useActionState(createCity, idleState);

  return (
    <form action={action} className="space-y-4">
      <Field label="City name" error={fieldError(state, 'name')}>
        <Input name="name" placeholder="Windsor" required />
      </Field>

      <Field label="Province" error={fieldError(state, 'province')}>
        <Input name="province" defaultValue="ON" maxLength={2} required />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Adding…">Add city</SubmitButton>
    </form>
  );
}
