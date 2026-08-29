import { z } from 'zod';

export const requestSeatSchema = z.object({
  departure_id: z.uuid('Unknown departure.'),
  // "fromStopId:toStopId" — one control, so a passenger picks a journey rather
  // than assembling one from two dropdowns that can disagree.
  boarding: z
    .string()
    .regex(
      /^[0-9a-f-]{36}:[0-9a-f-]{36}$/i,
      'Choose where you are getting on and off.',
    ),
  seats: z.coerce
    .number()
    .int()
    .min(1, 'Book at least one seat.')
    .max(8, 'For more than eight seats, call the operator directly.'),
  luggage_count: z.coerce
    .number()
    .int()
    .min(0)
    .max(20, 'That is more luggage than a van can take — call the operator.')
    .default(0),
  passenger_note: z
    .string()
    .trim()
    .max(300, 'Keep this under 300 characters.')
    .optional()
    .or(z.literal('')),
});

export const bookingIdSchema = z.object({
  booking_id: z.uuid(),
});

export const declineSchema = z.object({
  booking_id: z.uuid(),
});

export const paymentConfirmSchema = z.object({
  booking_id: z.uuid(),
  payment_method: z.enum(['cash', 'etransfer']),
});

export const driverPaymentSchema = z.object({
  booking_id: z.uuid(),
  received: z.enum(['yes', 'no']),
});

export const assignVehicleSchema = z.object({
  booking_id: z.uuid(),
  vehicle_id: z.string(),
});

export const departureVehicleSchema = z.object({
  departure_id: z.uuid(),
  vehicle_id: z.uuid('Choose a vehicle.'),
  driver_id: z.string().optional().or(z.literal('')),
});

export const ratingSchema = z.object({
  booking_id: z.uuid(),
  score: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  comment: z.string().trim().max(500, 'Keep this under 500 characters.').optional().or(z.literal('')),
});

export const redFlagSchema = z.object({
  booking_id: z.uuid(),
  reason: z.enum(['no_show', 'did_not_pay', 'haggled', 'too_loud', 'messy', 'smelly', 'other']),
  note: z.string().trim().max(500, 'Keep this under 500 characters.').optional().or(z.literal('')),
});

export const markNoShowSchema = z.object({
  booking_id: z.uuid(),
});

export const completeDepartureSchema = z.object({
  departure_id: z.uuid(),
});
