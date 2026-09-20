'use client';

import { useActionState, useState, useTransition } from 'react';

import { requestSeat } from '@/lib/booking/actions';
import { checkVoucher } from '@/lib/promotions/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { IconLuggage, IconSeat, IconTicket } from '@/components/icons';
import { idleState } from '@/lib/forms';
import { formatCents } from '@/lib/money';
import { describeVoucher, voucherDiscountCents } from '@/lib/promotions/vouchers';
import type { VoucherKind } from '@/lib/supabase/database.types';
import type { SurchargePolicy } from '@/lib/booking/fares';

type Stop = {
  stopId: string;
  label: string;
  cityName: string;
  description: string | null;
  isAirport: boolean;
};

type Boarding = {
  from: Stop;
  to: Stop;
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
  surcharges,
}: {
  departureId: string;
  boardings: Boarding[];
  surcharges: SurchargePolicy;
}) {
  const [state, action] = useActionState(requestSeat, idleState);
  const [choice, setChoice] = useState(
    `${boardings[0]?.from.stopId}:${boardings[0]?.to.stopId}`,
  );
  const [seats, setSeats] = useState(1);
  const [bags, setBags] = useState(1);

  // The code the passenger typed, and what the operator says it is worth. The
  // second is display only: request_booking() resolves the code again, holding
  // the row, and that is the answer they are charged.
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState<{ kind: VoucherKind; value: number } | null>(null);
  const [voucherNote, setVoucherNote] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();

  const selected =
    boardings.find((b) => `${b.from.stopId}:${b.to.stopId}` === choice) ?? boardings[0];

  const maxSeats = Math.min(selected?.seatsLeft ?? 1, 8);

  // The same arithmetic request_booking() does, so the running total is the
  // price that will be charged rather than an optimistic guess. The server
  // recomputes it regardless — this is display, not a decision.
  const base = (selected?.baseCents ?? 0) * seats;
  const extraBags = Math.max(0, bags - surcharges.freeLuggage * seats);
  const luggage = extraBags * surcharges.perExtraLuggageCents;
  const airport =
    selected && (selected.from.isAirport || selected.to.isAirport)
      ? surcharges.airportFeeCents * seats
      : 0;
  const beforeDiscount = base + luggage + airport;
  const discount = voucher
    ? voucherDiscountCents(voucher.kind, voucher.value, beforeDiscount)
    : 0;
  const total = beforeDiscount - discount;

  function applyCode() {
    const typed = code.trim();
    if (!typed) {
      setVoucher(null);
      setVoucherNote(null);
      return;
    }

    startChecking(async () => {
      const result = await checkVoucher(departureId, typed);
      if (result.ok) {
        setVoucher({ kind: result.kind, value: result.value });
        setVoucherNote(`${describeVoucher(result.kind, result.value, formatCents)} applied.`);
      } else {
        setVoucher(null);
        setVoucherNote(result.message);
      }
    });
  }

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
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                <IconSeat className="text-sm text-ink-400" />
                Seats
              </span>
            }
            error={fieldError(state, 'seats')}
          >
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
            label={
              <span className="inline-flex items-center gap-1.5">
                <IconLuggage className="text-sm text-ink-400" />
                Bags
              </span>
            }
            hint="Roughly, so the driver can plan the boot."
            error={fieldError(state, 'luggage_count')}
          >
            <Input
              name="luggage_count"
              type="number"
              min={0}
              max={20}
              value={bags}
              onChange={(event) => setBags(Math.max(0, Number(event.target.value) || 0))}
            />
          </Field>
        </div>

        {/*
          The code is submitted with the form whether or not Check was pressed,
          so a passenger who types one and goes straight to the button still
          gets their discount. Check only answers "did that work?" before they
          commit — and a code that does not work stops the booking with a
          reason rather than quietly charging full price.
        */}
        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              <IconTicket className="text-sm text-ink-400" />
              Voucher code (optional)
            </span>
          }
          hint="Six digits, from the operator. One booking per code."
          error={fieldError(state, 'voucher_code')}
        >
          <div className="flex gap-2">
            <Input
              name="voucher_code"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              autoComplete="off"
              className="numeric tracking-[0.2em]"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                setVoucher(null);
                setVoucherNote(null);
              }}
            />
            <Button
              type="button"
              tone="secondary"
              onClick={applyCode}
              disabled={checking || code.length !== 6}
              className="shrink-0"
            >
              {checking ? 'Checking…' : 'Check'}
            </Button>
          </div>
        </Field>

        {voucherNote ? (
          <p className={'-mt-3 text-sm ' + (voucher ? 'text-good-700' : 'text-bad-700')}>
            {voucherNote}
          </p>
        ) : null}

        <Field
          label="Anything to tell the operator? (optional)"
          hint="For example: female driver preferred, or front seat if possible."
          error={fieldError(state, 'passenger_note')}
        >
          <Textarea name="passenger_note" rows={2} />
        </Field>

        <dl className="space-y-1.5 rounded-xl bg-ink-50 p-4 text-sm ring-1 ring-ink-200">
          <div className="flex justify-between text-ink-600">
            <dt>
              {seats} seat{seats === 1 ? '' : 's'} at {formatCents(selected?.baseCents ?? 0)}
            </dt>
            <dd className="numeric">{formatCents(base)}</dd>
          </div>
          {luggage > 0 ? (
            <div className="flex justify-between text-ink-600">
              <dt>
                {extraBags} extra bag{extraBags === 1 ? '' : 's'}
              </dt>
              <dd className="numeric">{formatCents(luggage)}</dd>
            </div>
          ) : null}
          {airport > 0 ? (
            <div className="flex justify-between text-ink-600">
              <dt>Airport fee</dt>
              <dd className="numeric">{formatCents(airport)}</dd>
            </div>
          ) : null}
          {discount > 0 ? (
            <div className="flex justify-between font-medium text-good-700">
              <dt>Voucher {code}</dt>
              <dd className="numeric">−{formatCents(discount)}</dd>
            </div>
          ) : null}
          <div className="mt-1 flex items-baseline justify-between border-t border-ink-200 pt-2.5 font-semibold text-ink-900">
            <dt>Total, paid to the driver</dt>
            <dd className="numeric text-2xl">{formatCents(total)}</dd>
          </div>
        </dl>

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
