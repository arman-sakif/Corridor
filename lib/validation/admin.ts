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
  current_period_end: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30.')
    .optional()
    .or(z.literal('')),
});
