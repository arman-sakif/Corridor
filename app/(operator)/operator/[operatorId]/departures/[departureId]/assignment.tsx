'use client';

import { useActionState } from 'react';

import { assignBookingVehicle, raiseRedFlag } from '@/lib/booking/day-actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Select, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';

/**
 * Assignment is a dropdown that submits on change: on a departure morning an
 * operator is moving eight people between two vans, and a save button on each
 * row would be eight extra clicks.
 */
export function AssignVehicleControl({
  bookingId,
  current,
  vehicles,
}: {
  bookingId: string;
  current: string | null;
  vehicles: { id: string; label: string }[];
}) {
  if (vehicles.length === 0) {
    return <span className="text-xs text-ink-400">no vehicle yet</span>;
  }

  return (
    <form action={assignBookingVehicle}>
      <input type="hidden" name="booking_id" value={bookingId} />
      <Select
        name="vehicle_id"
        defaultValue={current ?? ''}
        className="h-8 text-xs"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">Not assigned</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.label}
          </option>
        ))}
      </Select>
    </form>
  );
}

const reasons = [
  { value: 'no_show', label: 'Did not turn up' },
  { value: 'did_not_pay', label: 'Did not pay' },
  { value: 'haggled', label: 'Haggled over the fare' },
  { value: 'too_loud', label: 'Too loud' },
  { value: 'messy', label: 'Left a mess' },
  { value: 'smelly', label: 'Hygiene' },
  { value: 'other', label: 'Something else' },
];

export function RedFlagForm({ passengers }: { passengers: { id: string; name: string }[] }) {
  const [state, action] = useActionState(raiseRedFlag, idleState);

  if (passengers.length === 0) {
    return <p className="text-sm text-ink-500">Nobody travelled on this departure.</p>;
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Passenger" error={fieldError(state, 'booking_id')}>
        <Select name="booking_id" required defaultValue="">
          <option value="" disabled>
            Choose a passenger
          </option>
          {passengers.map((passenger) => (
            <option key={passenger.id} value={passenger.id}>
              {passenger.name}
            </option>
          ))}
        </Select>
      </Field>

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

      <Field label="Anything to add (optional)" error={fieldError(state, 'note')}>
        <Textarea name="note" rows={2} />
      </Field>

      <FormMessage state={state} />

      <SubmitButton tone="danger" pendingLabel="Recording…">
        Record it
      </SubmitButton>
    </form>
  );
}
