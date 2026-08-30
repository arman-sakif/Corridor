import { z } from 'zod';

import { parseDollarsToCents } from '@/lib/money';
import { isValidServiceDate } from '@/lib/time';
import { phoneSchema } from './auth';

/** A dollar amount typed by an operator, stored as integer cents. */
export const priceSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const cents = parseDollarsToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter a price like 45 or 45.50.' });
      return z.NEVER;
    }
    return cents;
  });

export const operatorApplicationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter the name passengers know you by.')
    .max(120, 'That name is too long.'),
  type: z.enum(['intercity', 'incity']).default('intercity'),
  public_phone: phoneSchema,
  bio: z
    .string()
    .trim()
    .max(500, 'Keep this under 500 characters.')
    .optional()
    .or(z.literal('')),
});

/**
 * Surcharges are fixed amounts, never percentages. The free allowance is per
 * seat, so a party of two carries two bags before anything is charged.
 */
export const surchargeSchema = z.object({
  operator_id: z.uuid(),
  free_luggage_per_seat: z.coerce
    .number()
    .int()
    .min(0, 'Use 0 if every bag is charged.')
    .max(10, 'That is more free luggage than a van can take.'),
  extra_luggage: priceSchema,
  airport_fee: priceSchema,
});

export const operatorProfileSchema = z.object({
  operator_id: z.uuid(),
  name: z.string().trim().min(2, 'Enter the name passengers know you by.').max(120),
  public_phone: phoneSchema,
  bio: z.string().trim().max(500, 'Keep this under 500 characters.').optional().or(z.literal('')),
});

/* ------------------------------------------------------------------ stops */

export const stopSchema = z.object({
  operator_id: z.uuid(),
  stop_id: z.uuid().optional().or(z.literal('')),
  city_id: z.uuid('Choose the city this stop is in.'),
  label: z
    .string()
    .trim()
    .min(3, 'Name the pickup point, such as "Yorkdale Mall".')
    .max(120, 'That label is too long.'),
  description: z
    .string()
    .trim()
    .max(300, 'Keep this under 300 characters.')
    .optional()
    .or(z.literal('')),
  // Checkbox: present means on. There is no geocoding anywhere in this system,
  // so the operator is the one who says a stop is at an airport.
  is_airport: z
    .union([z.literal('on'), z.literal('true'), z.undefined()])
    .transform((value) => value !== undefined),
});

/* ----------------------------------------------------------------- routes */

export const routeSchema = z.object({
  operator_id: z.uuid(),
  route_id: z.uuid().optional().or(z.literal('')),
  name: z
    .string()
    .trim()
    .min(3, 'Name the route, such as "Windsor to Toronto — morning".')
    .max(120, 'That name is too long.'),
  pricing_mode: z.enum(['matrix', 'additive']).default('matrix'),
  // Ordered stop ids, first to last. A route runs one direction only.
  stop_ids: z
    .union([z.array(z.string()), z.string()])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .pipe(
      z
        .array(z.uuid())
        .min(2, 'A route needs at least two stops.')
        .max(12, 'Twelve stops is the most a route can have.')
        .refine((ids) => new Set(ids).size === ids.length, 'Each stop can appear only once.'),
    ),
});

export const fareSchema = z.object({
  route_id: z.uuid(),
  from_seq: z.coerce.number().int().min(1),
  to_seq: z.coerce.number().int().min(2),
  price: priceSchema,
  reason: z
    .string()
    .trim()
    .min(3, 'Say why the price changed — "fuel prices", "winter traffic".')
    .max(200, 'Keep the reason short.'),
});

/* -------------------------------------------------------------- schedules */

export const scheduleSchema = z.object({
  operator_id: z.uuid(),
  schedule_id: z.uuid().optional().or(z.literal('')),
  route_id: z.uuid('Choose which route this runs.'),
  departure_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a departure time like 09:00.'),
  // Checkboxes arrive as one value or many, and always as strings.
  days_of_week: z
    .union([z.array(z.string()), z.string()])
    .transform((value) => (Array.isArray(value) ? value : [value]).map(Number))
    .pipe(
      z
        .array(z.number().int().min(0).max(6))
        .min(1, 'Choose at least one day this runs.'),
    ),
  max_seats: z.coerce
    .number()
    .int()
    .min(1, 'A departure needs at least one seat.')
    .max(60, 'That is more seats than a departure can hold.'),
  active_from: z.string().refine(isValidServiceDate, 'Enter a start date like 2026-09-01.'),
  active_to: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine((v) => !v || isValidServiceDate(v), 'Enter an end date like 2026-12-31.'),
});

/* --------------------------------------------------------- fleet and team */

export const vehicleSchema = z.object({
  operator_id: z.uuid(),
  vehicle_id: z.uuid().optional().or(z.literal('')),
  label: z
    .string()
    .trim()
    .min(2, 'Name the vehicle, such as "Grey Sienna".')
    .max(80, 'That label is too long.'),
  seat_count: z.coerce
    .number()
    .int()
    .min(1, 'A vehicle needs at least one passenger seat.')
    .max(60, 'That is more seats than a vehicle can hold.'),
});

export const memberInviteSchema = z.object({
  operator_id: z.uuid(),
  email: z.email('Enter the email address they sign in with.').transform((v) => v.toLowerCase()),
  role: z.enum(['owner', 'staff', 'driver']),
});

export const memberRemoveSchema = z.object({
  operator_id: z.uuid(),
  member_id: z.uuid(),
});

export const inviteRevokeSchema = z.object({
  operator_id: z.uuid(),
  invite_id: z.uuid(),
});
