'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signInWithGoogle, signInWithPassword } from '@/lib/auth/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Field, Input } from '@/components/ui';
import { IconGoogle } from '@/components/icons';
import { dynamicRoute } from '@/lib/routes';
import { idleState } from '@/lib/forms';

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInWithPassword, idleState);

  return (
    <div className="space-y-5">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" tone="secondary" size="lg" className="w-full">
          <IconGoogle className="text-lg" />
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

        <Field label="Password" error={fieldError(state, 'password')}>
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>

        <FormMessage state={state} />

        <SubmitButton size="lg" className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <p className="text-center text-sm">
        <Link
          href={dynamicRoute(`/forgot-password?next=${encodeURIComponent(next)}`)}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Forgot your password?
        </Link>
      </p>
    </div>
  );
}
