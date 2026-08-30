'use client';

import { useId, useState, type ReactNode } from 'react';

import { Field, Input } from '@/components/ui';
import { IconEye, IconEyeOff } from '@/components/icons';
import { MIN_PASSWORD_LENGTH, scorePassword } from '@/lib/auth/password-strength';

/**
 * A password input with a reveal toggle and a strength meter.
 *
 * The meter is advice, not a gate — the only rule that blocks a submit is the
 * eight-character minimum, and it is enforced on the server like every other
 * rule. Three bars because that is what people already recognise from every
 * other signup form they have filled in; inventing a fourth state here would
 * only make it slower to read.
 */

const BAR_TONE = ['', 'bg-bad-600', 'bg-warn-600', 'bg-good-600'] as const;
const LABEL_TONE = ['text-ink-500', 'text-bad-700', 'text-warn-700', 'text-good-700'] as const;

export function PasswordField({
  name = 'password',
  label = 'Password',
  autoComplete = 'new-password',
  personal = [],
  error,
  required = true,
}: {
  name?: string;
  label?: ReactNode;
  autoComplete?: string;
  /** Their name, email, phone — a password built from these is downgraded. */
  personal?: string[];
  error?: ReactNode;
  required?: boolean;
}) {
  const [value, setValue] = useState('');
  const [revealed, setRevealed] = useState(false);
  const meterId = useId();

  const strength = scorePassword(value, personal.filter(Boolean));

  return (
    <Field label={label} error={error}>
      <div className="relative">
        <Input
          name={name}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          minLength={MIN_PASSWORD_LENGTH}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={meterId}
          className="pr-11"
        />
        <button
          type="button"
          // Keep the caret where it was: revealing the password should not
          // cost you your place in it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setRevealed((shown) => !shown)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-500 transition-colors hover:text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {revealed ? <IconEyeOff className="text-base" /> : <IconEye className="text-base" />}
        </button>
      </div>

      {value ? (
        <span id={meterId} className="mt-2 block">
          <span aria-hidden="true" className="flex gap-1">
            {[1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  strength.score >= bar ? BAR_TONE[strength.score] : 'bg-ink-200'
                }`}
              />
            ))}
          </span>
          <span
            aria-live="polite"
            className={`mt-1.5 block text-xs font-medium ${LABEL_TONE[strength.score]}`}
          >
            {strength.score === 0
              ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
              : `${strength.label} password.`}
          </span>
        </span>
      ) : (
        <span className="mt-1.5 block text-xs text-ink-500">
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      )}
    </Field>
  );
}
