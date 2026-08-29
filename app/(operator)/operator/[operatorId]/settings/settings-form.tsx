'use client';

import { useActionState } from 'react';

import { saveOperatorProfile } from '@/lib/operator/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function OperatorSettingsForm({
  operator,
}: {
  operator: { id: string; name: string; bio: string | null; public_phone: string | null };
}) {
  const [state, action] = useActionState(saveOperatorProfile, idleState);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="operator_id" value={operator.id} />

      <Field label="Business name" error={fieldError(state, 'name')}>
        <Input name="name" defaultValue={operator.name} required />
      </Field>

      <Field
        label="Phone number passengers can call"
        error={fieldError(state, 'public_phone')}
      >
        <Input name="public_phone" type="tel" defaultValue={operator.public_phone ?? ''} required />
      </Field>

      <Field
        label="About the business"
        hint="Shown on your profile. A sentence or two is plenty."
        error={fieldError(state, 'bio')}
      >
        <Textarea name="bio" rows={4} defaultValue={operator.bio ?? ''} />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
    </form>
  );
}
