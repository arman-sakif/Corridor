import { z } from 'zod';

import { parseDollarsToCents } from '@/lib/money';
import { normaliseVoucherCode, VOUCHER_CODE_PATTERN } from '@/lib/promotions/vouchers';

/**
 * Promotions: the codes an operator issues, and the code a passenger types.
 *
 * `value` means two different things depending on `kind` — cents off, or whole
 * percent off — so it arrives as text and is converted here, once, with a
 * message written for whoever typed it.
 */

export const voucherSchema = z
  .object({
    operator_id: z.uuid(),
    kind: z.enum(['amount', 'percent']),
    value: z.string().trim().min(1, 'Say how much comes off.'),
    validity: z.enum(['3d', '7d', '1m', '4m'], {
      error: 'Choose how long the code lasts.',
    }),
    max_uses: z.coerce
      .number()
      .int()
      .min(1, 'A code has to be usable at least once.')
      .max(10000, 'That is more than any promotion needs. Try 500.'),
  })
  .transform((data, ctx) => {
    if (data.kind === 'percent') {
      const percent = Number(data.value);
      if (!/^\d{1,3}$/.test(data.value) || percent < 1 || percent > 100) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'Enter a whole percentage between 1 and 100.',
        });
        return z.NEVER;
      }
      return { ...data, value: percent };
    }

    const cents = parseDollarsToCents(data.value);
    if (cents === null || cents < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Enter an amount like 5 or 7.50.',
      });
      return z.NEVER;
    }
    if (cents > 100000) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'The most a single code can take off is $1,000.',
      });
      return z.NEVER;
    }
    return { ...data, value: cents };
  });

export const voucherToggleSchema = z.object({
  operator_id: z.uuid(),
  voucher_id: z.uuid(),
  active: z.enum(['on', 'off']),
});

/**
 * Six letters or numbers, normalised and checked before it is sent anywhere. A
 * typo should be answered by the form rather than by a round trip.
 */
export const voucherCodeSchema = z.object({
  departure_id: z.uuid(),
  code: z
    .string()
    .transform(normaliseVoucherCode)
    .refine((code) => VOUCHER_CODE_PATTERN.test(code), 'A voucher code is six letters or numbers.'),
});
