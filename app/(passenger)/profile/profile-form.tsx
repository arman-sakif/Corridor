'use client';

import { useActionState } from 'react';

import { saveProfile } from '@/lib/auth/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';
import type { Tables } from '@/lib/supabase/database.types';

export function ProfileForm({
  profile,
  email,
  next,
}: {
  profile: Tables<'profiles'> | null;
  email: string | null;
  next?: string;
}) {
  const [state, action] = useActionState(saveProfile, idleState);

  return (
    <form action={action} className="space-y-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field label="Email" hint="Sign-in address. Contact support to change it.">
        <Input value={email ?? ''} disabled readOnly />
      </Field>

      <Field
        label="Full name"
        hint="The name the driver will look for."
        error={fieldError(state, 'full_name')}
      >
        <Input
          name="full_name"
          defaultValue={profile?.full_name ?? ''}
          autoComplete="name"
          required
        />
      </Field>

      <Field
        label="Phone number"
        hint="Operators call or text this to confirm pickup."
        error={fieldError(state, 'phone')}
      >
        <Input name="phone" type="tel" defaultValue={profile?.phone ?? ''} autoComplete="tel" required />
      </Field>

      <Field
        label="Gender (optional)"
        hint="Some passengers prefer to travel with this shared. Leave it blank if you would rather not."
        error={fieldError(state, 'gender')}
      >
        <Input name="gender" defaultValue={profile?.gender ?? ''} />
      </Field>

      <Field
        label="Anything the operator should know (optional)"
        hint="Mobility needs, a car seat, travelling with a pet — anything that affects the trip."
        error={fieldError(state, 'accommodation_notes')}
      >
        <Textarea
          name="accommodation_notes"
          rows={3}
          defaultValue={profile?.accommodation_notes ?? ''}
        />
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
    </form>
  );
}
