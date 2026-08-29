'use client';

import { useActionState } from 'react';

import { rateOperator } from '@/lib/booking/day-actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

const scores = [
  { value: 5, label: 'Great' },
  { value: 4, label: 'Good' },
  { value: 3, label: 'Fine' },
  { value: 2, label: 'Poor' },
  { value: 1, label: 'Bad' },
];

export function RatingForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState(rateOperator, idleState);

  if (state.status === 'success') {
    return <p className="text-sm text-good-700">{state.message}</p>;
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="booking_id" value={bookingId} />

      <Field label="How was the trip?" error={fieldError(state, 'score')}>
        <div className="flex flex-wrap gap-2">
          {scores.map((score) => (
            <label
              key={score.value}
              className="cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 ring-ink-200 select-none has-checked:bg-brand-600 has-checked:text-white has-checked:ring-brand-600"
            >
              <input type="radio" name="score" value={score.value} className="sr-only" required />
              {score.label}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Anything to add? (optional)" error={fieldError(state, 'comment')}>
        <Textarea name="comment" rows={2} placeholder="Left on time, driver was helpful." />
      </Field>

      <FormMessage state={state} />

      <SubmitButton tone="secondary" pendingLabel="Sending…">
        Leave rating
      </SubmitButton>
    </form>
  );
}
