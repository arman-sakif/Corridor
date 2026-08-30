import { z } from 'zod';

/**
 * In-city: zones an operator sells, and the local ride a passenger adds to a
 * confirmed seat.
 *
 * Messages are written for the person who typed the field, like every other
 * schema here.
 */

export const zoneSchema = z.object({
  operator_id: z.uuid(),
  zone_id: z.uuid().optional(),
  name: z
    .string()
    .trim()
    .min(2, 'Give the area a name passengers will recognise.')
    .max(80, 'That name is too long.'),
  // Typed in dollars, stored in cents. Money is integer cents everywhere.
  price: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a price like 22 or 22.50.')
    .transform((value) => Math.round(Number(value) * 100)),
  is_active: z
    .union([z.literal('on'), z.literal('')])
    .optional()
    .transform((value) => value === 'on'),
});

export const zoneToggleSchema = z.object({
  operator_id: z.uuid(),
  zone_id: z.uuid(),
});

/**
 * The address is free text on purpose. There are no coordinates anywhere in
 * this system, so nothing can check an address against a zone — the passenger
 * names the area, writes where they are going, and the driver reads both.
 */
export const incityRequestSchema = z.object({
  booking_id: z.uuid(),
  operator_id: z.uuid(),
  pickup_stop_id: z.uuid(),
  zone_id: z.uuid(),
  destination_address: z
    .string()
    .trim()
    .min(5, 'Where should the driver take you? A street address is enough.')
    .max(200, 'Keep this under 200 characters.'),
});

export const incityRideSchema = z.object({
  ride_id: z.uuid(),
  operator_id: z.uuid().optional(),
  booking_id: z.uuid().optional(),
});
