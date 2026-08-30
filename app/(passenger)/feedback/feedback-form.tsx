'use client';

import { useActionState } from 'react';

import { sendFeedback } from '@/lib/reports/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Select, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

const kinds = [
  { value: 'idea', label: 'Something I wish it did' },
  { value: 'problem', label: 'Something that annoyed me' },
  { value: 'praise', label: 'Something that worked well' },
  { value: 'other', label: 'Something else' },
] as const;

export function FeedbackForm() {
  const [state, action] = useActionState(sendFeedback, idleState);

  return (
    <form action={action} className="space-y-4">
      <Field label="What kind of thing" error={fieldError(state, 'kind')}>
        <Select name="kind" required defaultValue="idea">
          {kinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Tell us"
        hint="Plain words are fine. There is no form to fill in properly."
        error={fieldError(state, 'message')}
      >
        <Textarea name="message" rows={5} required placeholder="Search should remember where I usually go." />
      </Field>

      <FormMessage state={state} />

      <SubmitButton size="lg" pendingLabel="Sending…">
        Send it
      </SubmitButton>
    </form>
  );
}
