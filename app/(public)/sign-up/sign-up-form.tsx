'use client';

import { useActionState, useState } from 'react';

import { signUpWithPassword } from '@/lib/auth/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { GoogleButton } from '@/components/google-button';
import { PasswordField } from '@/components/password-field';
import { Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUpWithPassword, idleState);

  // Held here only so the strength meter can tell someone their password is
  // their own name back at them. Nothing else reads them.
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  return (
    <div className="space-y-5">
      <GoogleButton next={next} />

      <div className="flex items-center gap-3 text-xs text-ink-400">
        <span className="h-px flex-1 bg-ink-200" />
        or
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        <Field label="Full name" error={fieldError(state, 'full_name')}>
          <Input
            name="full_name"
            autoComplete="name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>

        <Field label="Email" error={fieldError(state, 'email')}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field
          label="Phone number"
          hint="Operators call or text this to confirm your seat."
          error={fieldError(state, 'phone')}
        >
          <Input name="phone" type="tel" autoComplete="tel" required />
        </Field>

        <PasswordField
          personal={[fullName, email]}
          error={fieldError(state, 'password')}
          autoComplete="new-password"
        />

        <FormMessage state={state} />

        <SubmitButton size="lg" className="w-full" pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
    </div>
  );
}
