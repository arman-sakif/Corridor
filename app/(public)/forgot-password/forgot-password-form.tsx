'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { requestRecovery, verifyLoginCode } from '@/lib/auth/recovery';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Field, Input } from '@/components/ui';
import { dynamicRoute } from '@/lib/routes';
import { idleState } from '@/lib/forms';

type Method = 'code' | 'link';

export function ForgotPasswordForm({ next }: { next: string }) {
  const [requestState, request] = useActionState(requestRecovery, idleState);
  const [codeState, verify] = useActionState(verifyLoginCode, idleState);

  const [email, setEmail] = useState('');
  // Which button was pressed. The action returns the same sentence either way
  // — on purpose — so the form has to remember what it asked for.
  const [method, setMethod] = useState<Method>('code');
  const [enteringCode, setEnteringCode] = useState(false);

  // Only ever act on a genuinely new result. Reacting to `method` alone would
  // jump to the code step the instant someone *clicked* the code button after
  // an earlier successful send, before the new request had gone anywhere.
  const seen = useRef(requestState);
  useEffect(() => {
    if (requestState === seen.current) return;
    seen.current = requestState;
    if (requestState.status === 'success' && method === 'code') setEnteringCode(true);
  }, [requestState, method]);

  if (enteringCode) {
    return (
      <form action={verify} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />

        <p className="text-sm text-ink-600">
          We sent a code to <span className="font-medium text-ink-900">{email}</span>. It works for
          an hour.
        </p>

        {/*
          No fixed length here. How many digits GoTrue issues is a project
          setting, and this one sends eight where the CLI default is six —
          a maxLength of 6 would have silently truncated every real code.
        */}
        <Field label="Sign-in code" error={fieldError(codeState, 'code')}>
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            placeholder="Paste it here"
            required
            autoFocus
            className="text-center text-lg tracking-[0.3em]"
          />
        </Field>

        <FormMessage state={codeState} />

        <SubmitButton size="lg" className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>

        <p className="text-center text-sm text-ink-600">
          <button
            type="button"
            onClick={() => setEnteringCode(false)}
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Use a different address, or send another code
          </button>
        </p>
      </form>
    );
  }

  return (
    <form action={request} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <Field
        label="Email"
        hint="The address you signed up with."
        error={fieldError(requestState, 'email')}
      >
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      <FormMessage state={requestState} />

      <div className="space-y-2">
        <MethodButton method="code" chosen={method} onChoose={setMethod} tone="primary">
          Email me a sign-in code
        </MethodButton>
        <MethodButton method="link" chosen={method} onChoose={setMethod} tone="secondary">
          Email me a password reset link
        </MethodButton>
      </div>

      <p className="pt-1 text-center text-sm text-ink-600">
        Remembered it?{' '}
        <Link
          href={dynamicRoute(`/sign-in?next=${encodeURIComponent(next)}`)}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

/**
 * Two submits on one form. `useFormStatus` reports the form as pending, not a
 * particular button, so without the `chosen` check both would claim to be
 * working and neither would be telling the truth.
 */
function MethodButton({
  method,
  chosen,
  onChoose,
  tone,
  children,
}: {
  method: Method;
  chosen: Method;
  onChoose: (method: Method) => void;
  tone: 'primary' | 'secondary';
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  const working = pending && chosen === method;

  return (
    <Button
      type="submit"
      name="method"
      value={method}
      tone={tone}
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={() => onChoose(method)}
    >
      {working ? 'Sending…' : children}
    </Button>
  );
}
