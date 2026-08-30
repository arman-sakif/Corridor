import { z } from 'zod';

export const cityCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter the city name as passengers would search for it.')
    .max(80, 'That name is too long.'),
  province: z
    .string()
    .trim()
    .length(2, 'Use the two-letter province code, such as ON.')
    .transform((value) => value.toUpperCase())
    .default('ON'),
});

export const cityToggleSchema = z.object({
  city_id: z.uuid('Unknown city.'),
  is_active: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

export const operatorStatusSchema = z.object({
  operator_id: z.uuid('Unknown operator.'),
  status: z.enum(['pending', 'active', 'suspended']),
});

export const subscriptionSchema = z.object({
  operator_id: z.uuid('Unknown operator.'),
  plan: z.enum(['weekly', 'monthly']),
  status: z.enum(['active', 'past_due', 'cancelled']),
  // Per operator, not per plan: the first customers of anything are signed one
  // at a time, and a founding discount should not need a code change.
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 120 or 120.00.')
    .transform((value) => Math.round(Number(value) * 100))
    .optional()
    .or(z.literal('').transform(() => 0)),
  /** Ticked when this save is recording money that actually arrived. */
  record_payment: z
    .union([z.literal('on'), z.literal('')])
    .optional()
    .transform((value) => value === 'on'),
  current_period_end: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30.')
    .optional()
    .or(z.literal('')),
});
