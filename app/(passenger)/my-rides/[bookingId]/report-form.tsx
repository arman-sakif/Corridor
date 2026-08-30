'use client';

import { useActionState } from 'react';

import { fileReport } from '@/lib/reports/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Select, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

/**
 * Reporting a trip.
 *
 * The trip, not a person: a passenger never sees the driver or the vehicle, so
 * they could not name one if they wanted to. The operator and Corridor can
 * both look up who was driving, and they are the ones who need to.
 */
const categories = [
  { value: 'driving', label: 'How the vehicle was driven' },
  { value: 'lateness', label: 'Very late, or never came' },
  { value: 'vehicle', label: 'The state of the vehicle' },
  { value: 'conduct', label: 'How I was treated' },
  { value: 'overcharged', label: 'I was charged the wrong amount' },
  { value: 'safety', label: 'I felt unsafe' },
  { value: 'other', label: 'Something else' },
] as const;

export function ReportForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState(fileReport, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="booking_id" value={bookingId} />

      <Field label="What went wrong" error={fieldError(state, 'category')}>
        <Select name="category" required defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="What happened"
        hint="Write it the way you would tell someone. The operator reads this, and so does Corridor."
        error={fieldError(state, 'note')}
      >
        <Textarea name="note" rows={4} required />
      </Field>

      <FormMessage state={state} />

      <SubmitButton tone="danger" pendingLabel="Reporting…">
        Report this trip
      </SubmitButton>
    </form>
  );
}
