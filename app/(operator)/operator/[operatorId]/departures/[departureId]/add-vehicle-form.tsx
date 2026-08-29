'use client';

import { useActionState } from 'react';

import { addVehicleToDeparture } from '@/lib/booking/day-actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function AddVehicleForm({
  departureId,
  vehicles,
  drivers,
}: {
  departureId: string;
  vehicles: { id: string; label: string; seat_count: number }[];
  drivers: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(addVehicleToDeparture, idleState);

  if (vehicles.length === 0) {
    return (
      <p className="text-xs text-ink-500">
        Every vehicle in your fleet is already on this departure.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3 border-t border-ink-100 pt-4">
      <input type="hidden" name="departure_id" value={departureId} />

      <Field label="Add a vehicle" error={fieldError(state, 'vehicle_id')}>
        <Select name="vehicle_id" required defaultValue="">
          <option value="" disabled>
            Choose from your fleet
          </option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.label} — {vehicle.seat_count} seats
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Driver (optional)" error={fieldError(state, 'driver_id')}>
        <Select name="driver_id" defaultValue="">
          <option value="">Decide later</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.name}
            </option>
          ))}
        </Select>
      </Field>

      <FormMessage state={state} />

      <SubmitButton size="sm" tone="secondary" pendingLabel="Adding…">
        Add to this trip
      </SubmitButton>
    </form>
  );
}
