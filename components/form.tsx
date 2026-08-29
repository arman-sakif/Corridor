'use client';

import { useFormStatus } from 'react-dom';

import { Alert, Button, type ButtonSize, type ButtonTone } from '@/components/ui';
import type { FormState } from '@/lib/forms';

/**
 * A submit button that says what it is doing while it does it. The pending
 * label keeps the same verb as the idle one: "Request seat" → "Requesting…".
 */
export function SubmitButton({
  children,
  pendingLabel,
  tone = 'primary',
  size = 'md',
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" tone={tone} size={size} className={className} disabled={pending}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/** Renders whatever the last Server Action call returned. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'success' && !state.message) return null;

  return (
    <Alert tone={state.status === 'success' ? 'good' : 'bad'}>
      {state.status === 'success' ? state.message : state.message}
    </Alert>
  );
}

export function fieldError(state: FormState, field: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.[field] : undefined;
}
