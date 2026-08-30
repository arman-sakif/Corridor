'use client';

import { useActionState } from 'react';

import { updatePassword } from '@/lib/auth/recovery';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { PasswordField } from '@/components/password-field';
import { idleState } from '@/lib/forms';

export function UpdatePasswordForm({ next, personal }: { next: string; personal: string[] }) {
  const [state, action] = useActionState(updatePassword, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <PasswordField
        label="New password"
        personal={personal}
        error={fieldError(state, 'password')}
        autoComplete="new-password"
      />

      <FormMessage state={state} />

      <SubmitButton size="lg" className="w-full" pendingLabel="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
