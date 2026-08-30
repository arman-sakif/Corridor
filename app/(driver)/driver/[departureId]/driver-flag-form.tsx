'use client';

import { useActionState, useState } from 'react';

import { raiseRedFlag } from '@/lib/booking/day-actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Field, Input, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';

/**
 * A driver's mark on a passenger.
 *
 * Collapsed behind a link by default: the manifest is read at a kerb with a
 * van full of people waiting, and a form per rider open at all times would
 * bury the two buttons that matter on the day.
 *
 * The same reasons the operator sees, in the same words.
 */
const reasons = [
  { value: 'no_show', label: 'Did not turn up' },
  { value: 'did_not_pay', label: 'Did not pay' },
  { value: 'haggled', label: 'Haggled over the fare' },
  { value: 'too_loud', label: 'Too loud' },
  { value: 'messy', label: 'Left a mess' },
  { value: 'smelly', label: 'Hygiene' },
  { value: 'other', label: 'Something else' },
] as const;

export function DriverFlagForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState(raiseRedFlag, idleState);
  const [open, setOpen] = useState(false);

  if (state.status === 'success') {
    return <p className="text-xs font-medium text-good-700">{state.message}</p>;
  }

  if (!open) {
    return (
      <Button type="button" tone="ghost" size="sm" onClick={() => setOpen(true)}>
        Flag this passenger
      </Button>
    );
  }

  return (
    <form action={action} className="w-56 space-y-2">
      <input type="hidden" name="booking_id" value={bookingId} />

      <Field label="What happened" error={fieldError(state, 'reason')}>
        <Select name="reason" required defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </Select>
      </Field>

      <Input name="note" placeholder="Anything worth adding" />

      <FormMessage state={state} />

      <div className="flex gap-2">
        <SubmitButton size="sm" tone="danger" pendingLabel="Recording…">
          Record
        </SubmitButton>
        <Button type="button" tone="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
