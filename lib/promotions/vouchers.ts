/**
 * Voucher arithmetic and vocabulary.
 *
 * ⚠ Display only. The authority on what a code is worth is `request_booking()`,
 * which resolves the code and recomputes the discount while holding the row —
 * the same stance `lib/booking/capacity.ts` takes towards seats. What is here
 * exists so the booking page can show a total before the passenger commits,
 * and so it has to agree with `voucher_discount_cents()` in
 * `20260920000030_vouchers.sql` exactly. Change one, change the other.
 */

import type { VoucherKind, VoucherWindow } from '@/lib/supabase/database.types';

/** The four windows, in the order an operator is offered them. */
export const VOUCHER_WINDOWS: { value: VoucherWindow; label: string }[] = [
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
  { value: '1m', label: '1 month' },
  { value: '4m', label: '4 months' },
];

export function windowLabel(validity: VoucherWindow): string {
  return VOUCHER_WINDOWS.find((w) => w.value === validity)?.label ?? validity;
}

/** The shape a stored code takes. Wider than the alphabet it is drawn from. */
export const VOUCHER_CODE_PATTERN = /^[0-9A-Z]{6}$/;

/**
 * What the passenger typed, as the code it means.
 *
 * Mirrors `normalise_voucher_code()` in `20260920000032_alphanumeric_vouchers.sql`
 * — change one, change the other.
 *
 * Codes are drawn from the digits plus the letters without I, L, O and U,
 * because a code gets read down a phone line and O against 0, and I or L
 * against 1, are the pairs that get misheard. Dropping the letter of each pair
 * rather than the digit means somebody who types the letter anyway is still
 * understood: `oil2ab` and `0112AB` are the same code.
 */
export function normaliseVoucherCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[OIL]/g, (c) => (c === 'O' ? '0' : '1'));
}

/**
 * What a code takes off a fare of `totalCents`.
 *
 * Integer division for the percentage — money is cents and a third of $45 is
 * not a number with a fraction in it. Capped at the fare, so a $20 code makes
 * a $15 trip free rather than something the operator owes.
 */
export function voucherDiscountCents(
  kind: VoucherKind,
  value: number,
  totalCents: number,
): number {
  if (totalCents <= 0) return 0;
  const raw = kind === 'percent' ? Math.floor((totalCents * value) / 100) : value;
  return Math.max(0, Math.min(raw, totalCents));
}

/** "$5 off" / "15% off" — how a code is described wherever it appears. */
export function describeVoucher(
  kind: VoucherKind,
  value: number,
  formatCents: (cents: number) => string,
): string {
  return kind === 'percent' ? `${value}% off` : `${formatCents(value)} off`;
}

export type VoucherState = 'live' | 'withdrawn' | 'expired' | 'used up';

/**
 * The one word a promotions page puts beside a code.
 *
 * Order matters: a withdrawn code that has also expired reads as withdrawn,
 * because that is the thing the operator did and the thing they can undo.
 */
export function voucherState(
  voucher: { is_active: boolean; expires_at: string; max_uses: number },
  uses: number,
  now: Date = new Date(),
): VoucherState {
  if (!voucher.is_active) return 'withdrawn';
  if (new Date(voucher.expires_at) <= now) return 'expired';
  if (uses >= voucher.max_uses) return 'used up';
  return 'live';
}
