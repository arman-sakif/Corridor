'use client';

import { useActionState, useState } from 'react';

import { ratePassenger } from '@/lib/booking/day-actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Field, Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

/**
 * Rating a passenger, from the operator's side or the driver's.
 *
 * Collapsed behind a link, like the flag form beside it: the manifest is read
 * at a kerb, and two forms open per rider would bury the buttons that matter
 * on the day.
 *
 * Deliberately not the same control as the flag. A flag records that something
 * went wrong; this records that nothing did, which is the thing the approval
 * queue has never been able to say about anyone.
 */
const scores = [
  { value: 5, label: 'No trouble at all' },
  { value: 4, label: 'Fine' },
  { value: 3, label: 'Mixed' },
  { value: 2, label: 'Hard work' },
  { value: 1, label: 'Would rather not again' },
] as const;

export function RatePassengerForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState(ratePassenger, idleState);
  const [open, setOpen] = useState(false);

  if (state.status === 'success') {
    return <p className="text-xs font-medium text-good-700">{state.message}</p>;
  }

  if (!open) {
    return (
      <Button type="button" tone="ghost" size="sm" onClick={() => setOpen(true)}>
        Rate this passenger
      </Button>
    );
  }

  return (
    <form action={action} className="w-56 space-y-2">
      <input type="hidden" name="booking_id" value={bookingId} />

      <Field label="How did it go" error={fieldError(state, 'score')}>
        <div className="space-y-1">
          {scores.map((score) => (
            <label key={score.value} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="score" value={score.value} required />
              {score.label}
            </label>
          ))}
        </div>
      </Field>

      <Input name="comment" placeholder="Anything worth adding" />

      <FormMessage state={state} />

      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <Button type="button" tone="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
