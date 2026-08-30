'use client';

import { useActionState, useState } from 'react';

import { requestIncityRide } from '@/lib/incity/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { idleState } from '@/lib/forms';
import type { IncityOffer } from '@/lib/incity/queries';

/**
 * One screen, one decision: where you are going and roughly which part of town
 * it is in. The price is a flat fare for the whole area, so it is known the
 * moment an area is picked — nobody should press the button wondering what it
 * will cost.
 */
export function OnwardForm({ bookingId, offer }: { bookingId: string; offer: IncityOffer }) {
  const [state, action] = useActionState(requestIncityRide, idleState);
  const [zoneId, setZoneId] = useState(offer.zones[0]?.id ?? '');

  const zone = offer.zones.find((candidate) => candidate.id === zoneId);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="booking_id" value={bookingId} />
      <input type="hidden" name="operator_id" value={offer.operatorId} />

      {offer.pickups.length > 1 ? (
        <Field
          label="Where they collect you"
          hint="Pick the one nearest where your bus drops you."
          error={fieldError(state, 'pickup_stop_id')}
        >
          <Select name="pickup_stop_id" required defaultValue={offer.pickups[0]?.id}>
            {offer.pickups.map((pickup) => (
              <option key={pickup.id} value={pickup.id}>
                {pickup.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <input type="hidden" name="pickup_stop_id" value={offer.pickups[0]?.id ?? ''} />
          <div className="rounded-xl bg-ink-50 px-4 py-3 text-sm">
            <span className="text-ink-500">They collect you at</span>{' '}
            <span className="font-medium text-ink-900">{offer.pickups[0]?.label}</span>
            {offer.pickups[0]?.description ? (
              <span className="mt-0.5 block text-xs text-ink-600">
                {offer.pickups[0].description}
              </span>
            ) : null}
          </div>
        </>
      )}

      <Field
        label="Which part of town"
        hint="One flat fare for anywhere in the area, whatever the exact address."
        error={fieldError(state, 'zone_id')}
      >
        <Select
          name="zone_id"
          required
          value={zoneId}
          onChange={(event) => setZoneId(event.target.value)}
        >
          {offer.zones.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} — {formatCents(option.flatPriceCents)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Where exactly"
        hint="The driver reads this, so write it the way you would tell a person."
        error={fieldError(state, 'destination_address')}
      >
        <Input name="destination_address" placeholder="12 Elm Street, buzzer 4" required />
      </Field>

      {zone ? (
        <div className="flex items-baseline justify-between rounded-xl bg-ink-50 px-4 py-3">
          <span className="text-sm text-ink-600">{zone.name}</span>
          <span className="numeric text-lg font-semibold text-ink-900">
            {formatCents(zone.flatPriceCents)}
          </span>
        </div>
      ) : null}

      <FormMessage state={state} />

      <SubmitButton size="lg" className="w-full" pendingLabel="Requesting…">
        Request local ride
      </SubmitButton>

      <p className="text-center text-xs text-ink-500">
        {offer.operatorName} confirms it separately from your seat. You pay their driver on the
        day — cash or e-transfer, same price.
      </p>
    </form>
  );
}
