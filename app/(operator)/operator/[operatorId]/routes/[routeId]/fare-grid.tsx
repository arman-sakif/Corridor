'use client';

import { useActionState, useState } from 'react';

import { setFare } from '@/lib/operator/setup';
import { FormMessage, SubmitButton } from '@/components/form';
import { Card, CardHeader, Field, Input, Table, Td, Th } from '@/components/ui';
import { centsToInput, formatCents } from '@/lib/money';
import { idleState } from '@/lib/forms';

type Stop = { seq: number; label: string; city: string };
type Fare = { from_seq: number; to_seq: number; price_cents: number };

/**
 * One price at a time, with a reason attached.
 *
 * A bulk grid save would be quicker to click through, but every change writes
 * an audit row and each row needs its own reason — "fuel prices" against nine
 * segments at once is not a record of anything.
 */
export function FareGrid({
  routeId,
  stops,
  fares,
  additive,
}: {
  routeId: string;
  stops: Stop[];
  fares: Fare[];
  additive: boolean;
}) {
  const [state, action] = useActionState(setFare, idleState);
  const [editing, setEditing] = useState<{ from: number; to: number } | null>(null);

  const priceOf = (from: number, to: number) =>
    fares.find((f) => f.from_seq === from && f.to_seq === to)?.price_cents ?? null;

  // Additive routes are priced hop by hop, so only consecutive pairs are
  // editable. Anything longer is derived, not stored.
  const pairs = stops.flatMap((from) =>
    stops
      .filter((to) => (additive ? to.seq === from.seq + 1 : to.seq > from.seq))
      .map((to) => ({ from, to })),
  );

  const active = editing
    ? pairs.find((p) => p.from.seq === editing.from && p.to.seq === editing.to)
    : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader
          title={additive ? 'Price each hop' : 'Price each pair of stops'}
          description={
            additive
              ? 'Only neighbouring stops are priced here. The rest is worked out from these.'
              : 'A pair with no price is simply not for sale.'
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>From</Th>
              <Th>To</Th>
              <Th className="text-right">Fare</Th>
              <Th className="text-right">Change</Th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(({ from, to }) => {
              const cents = priceOf(from.seq, to.seq);
              const isEditing = editing?.from === from.seq && editing?.to === to.seq;
              return (
                <tr key={`${from.seq}-${to.seq}`} className={isEditing ? 'bg-brand-50' : undefined}>
                  <Td>
                    <span className="font-medium text-ink-900">{from.city || from.label}</span>
                    <span className="block text-xs text-ink-500">{from.label}</span>
                  </Td>
                  <Td>
                    <span className="font-medium text-ink-900">{to.city || to.label}</span>
                    <span className="block text-xs text-ink-500">{to.label}</span>
                  </Td>
                  <Td className="numeric text-right">
                    {cents === null ? (
                      <span className="text-ink-400">not for sale</span>
                    ) : (
                      formatCents(cents)
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => setEditing({ from: from.seq, to: to.seq })}
                      className="rounded-lg px-2 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50"
                    >
                      {cents === null ? 'Set price' : 'Change'}
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="h-fit p-5">
        {active ? (
          <form action={action} className="space-y-4">
            <input type="hidden" name="route_id" value={routeId} />
            <input type="hidden" name="from_seq" value={active.from.seq} />
            <input type="hidden" name="to_seq" value={active.to.seq} />

            <div>
              <h2 className="font-semibold text-ink-900">
                {active.from.city || active.from.label} → {active.to.city || active.to.label}
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                {active.from.label} to {active.to.label}, this direction only.
              </p>
            </div>

            <Field label="Fare per seat">
              <Input
                name="price"
                inputMode="decimal"
                placeholder="45.00"
                defaultValue={
                  priceOf(active.from.seq, active.to.seq) === null
                    ? ''
                    : centsToInput(priceOf(active.from.seq, active.to.seq)!)
                }
                required
              />
            </Field>

            <Field
              label="Why the change"
              hint="Kept on record. Nobody has to approve it."
            >
              <Input name="reason" placeholder="fuel prices" required />
            </Field>

            <FormMessage state={state} />

            <div className="flex gap-2">
              <SubmitButton pendingLabel="Saving…">Save price</SubmitButton>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg px-3 text-sm font-medium text-ink-600 hover:text-ink-900"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="text-sm text-ink-600">
            <h2 className="font-semibold text-ink-900">Set a fare</h2>
            <p className="mt-1">
              Choose a pair of stops on the left. Prices are per seat, and cash and e-transfer cost
              the same.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
