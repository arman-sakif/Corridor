'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { requestRecovery, verifyLoginCode } from '@/lib/auth/recovery';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Field, Input } from '@/components/ui';
import { dynamicRoute } from '@/lib/routes';
import { idleState, type FormState } from '@/lib/forms';

type Method = 'code' | 'link';

export function ForgotPasswordForm({ next }: { next: string }) {
  const [requestState, request] = useActionState(requestRecovery, idleState);
  const [codeState, verify] = useActionState(verifyLoginCode, idleState);

  const [email, setEmail] = useState('');
  // Which button was pressed. The action returns the same sentence either way
  // — on purpose — so the form has to remember what it asked for.
  const [method, setMethod] = useState<Method>('code');

  // Which result the reader has already dismissed, held by identity rather
  // than as a boolean. Every send returns a fresh state object, so a new one
  // is never equal to the dismissed one and the code step reappears by
  // itself — no effect, and nothing to reset.
  const [dismissed, setDismissed] = useState<FormState | null>(null);

  // Derived during render rather than synchronised in an effect. Setting state
  // from an effect here would render twice and, worse, would have to reason
  // about ordering: `method` changes on *click*, before the new request has
  // gone anywhere, so an effect watching it would jump to the code step using
  // the previous request's result.
  const enteringCode =
    requestState.status === 'success' && method === 'code' && dismissed !== requestState;

  if (enteringCode) {
    return (
      <form action={verify} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />

        <p className="text-sm text-ink-600">
          We sent a code to <span className="font-medium text-ink-900">{email}</span>. It works for
          an hour, until you ask for another code or a reset link — that cancels this one.
        </p>

        {/*
          No fixed length here. How many digits GoTrue issues is a project
          setting, and this one sends eight where the CLI default is six —
          a maxLength of 6 would have silently truncated every real code.
        */}
        <Field label="Sign-in code" error={fieldError(codeState, 'code')}>
          {/*
            autoFocus is deliberate. This step exists only to receive the code:
            the field is the sole control on screen, the reader arrived here by
            asking for it, and a screen reader announces the label on focus, so
            the usual objection to stealing focus does not apply.

            jsx-a11y/no-autofocus is switched off in .oxlintrc.json rather than
            suppressed here — oxlint honours neither an inline nor a
            file-scoped disable for it. See docs/linting.md.
          */}
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
            onClick={() => setDismissed(requestState)}
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
        <p className="text-center text-xs text-ink-500">
          Each request cancels the code or link in any earlier email, so use the newest one.
        </p>
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
