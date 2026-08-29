'use client';

import { useActionState } from 'react';

import { signInWithGoogle, signUpWithPassword } from '@/lib/auth/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUpWithPassword, idleState);

  return (
    <div className="space-y-5">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" tone="secondary" size="lg" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-400">
        <span className="h-px flex-1 bg-ink-200" />
        or
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        <Field label="Email" error={fieldError(state, 'email')}>
          <Input name="email" type="email" autoComplete="email" required />
        </Field>

        <Field
          label="Password"
          hint="At least 8 characters."
          error={fieldError(state, 'password')}
        >
          <Input name="password" type="password" autoComplete="new-password" required />
        </Field>

        <FormMessage state={state} />

        <SubmitButton size="lg" className="w-full" pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
    </div>
  );
}
