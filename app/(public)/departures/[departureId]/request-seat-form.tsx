'use client';

import { useActionState, useState } from 'react';

import { requestSeat } from '@/lib/booking/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Card, Field, Input, Select, Textarea } from '@/components/ui';
import { idleState } from '@/lib/forms';
import { formatCents } from '@/lib/money';

type Boarding = {
  from: { stopId: string; label: string; cityName: string; description: string | null };
  to: { stopId: string; label: string; cityName: string; description: string | null };
  baseCents: number;
  seatsLeft: number;
};

/**
 * One screen, one decision: which pickup, how many seats. The running total
 * updates as they choose, so nobody presses the button wondering what it will
 * cost.
 */
export function RequestSeatForm({
  departureId,
  boardings,
}: {
  departureId: string;
  boardings: Boarding[];
}) {
  const [state, action] = useActionState(requestSeat, idleState);
  const [choice, setChoice] = useState(
    `${boardings[0]?.from.stopId}:${boardings[0]?.to.stopId}`,
  );
  const [seats, setSeats] = useState(1);

  const selected =
    boardings.find((b) => `${b.from.stopId}:${b.to.stopId}` === choice) ?? boardings[0];

  const maxSeats = Math.min(selected?.seatsLeft ?? 1, 8);
  const total = (selected?.baseCents ?? 0) * seats;

  return (
    <Card className="p-5">
      <form action={action} className="space-y-5">
        <input type="hidden" name="departure_id" value={departureId} />

        <Field label="Pickup and drop-off" error={fieldError(state, 'boarding')}>
          {boardings.length === 1 ? (
            <>
              <input type="hidden" name="boarding" value={choice} />
              <p className="rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-800">
                {selected?.from.label} → {selected?.to.label}
              </p>
            </>
          ) : (
            <Select
              name="boarding"
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value);
                setSeats(1);
              }}
            >
              {boardings.map((boarding) => (
                <option
                  key={`${boarding.from.stopId}:${boarding.to.stopId}`}
                  value={`${boarding.from.stopId}:${boarding.to.stopId}`}
                >
                  {boarding.from.label} → {boarding.to.label} · {formatCents(boarding.baseCents)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {selected?.from.description || selected?.to.description ? (
          <div className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600">
            {selected.from.description ? (
              <p>
                <strong>Pickup:</strong> {selected.from.description}
              </p>
            ) : null}
            {selected.to.description ? (
              <p className="mt-1">
                <strong>Drop-off:</strong> {selected.to.description}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Seats" error={fieldError(state, 'seats')}>
            <Select
              name="seats"
              value={seats}
              onChange={(event) => setSeats(Number(event.target.value))}
            >
              {Array.from({ length: Math.max(1, maxSeats) }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Bags"
            hint="Roughly, so the driver can plan the boot."
            error={fieldError(state, 'luggage_count')}
          >
            <Input name="luggage_count" type="number" min={0} max={20} defaultValue={1} />
          </Field>
        </div>

        <Field
          label="Anything to tell the operator? (optional)"
          hint="For example: female driver preferred, or front seat if possible."
          error={fieldError(state, 'passenger_note')}
        >
          <Textarea name="passenger_note" rows={2} />
        </Field>

        <div className="flex items-baseline justify-between border-t border-ink-100 pt-4">
          <span className="text-sm text-ink-600">
            {seats} seat{seats === 1 ? '' : 's'} at {formatCents(selected?.baseCents ?? 0)}
          </span>
          <span className="numeric text-xl font-semibold text-ink-900">{formatCents(total)}</span>
        </div>

        <FormMessage state={state} />

        <SubmitButton size="lg" className="w-full" pendingLabel="Requesting…">
          Request seat
        </SubmitButton>

        <p className="text-center text-xs text-ink-500">
          {selected && selected.seatsLeft <= 3
            ? `Only ${selected.seatsLeft} seat${selected.seatsLeft === 1 ? '' : 's'} left on this stretch. `
            : ''}
          The operator has an hour to confirm.
        </p>
      </form>
    </Card>
  );
}
