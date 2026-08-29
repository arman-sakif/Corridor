import { z } from 'zod';

/**
 * Messages are written to be read by the person who typed the field, so they
 * say what to do rather than what failed.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('That does not look like an email address.')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Passwords cannot be longer than 72 characters.');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  next: z.string().optional(),
});

/**
 * A phone number an operator can actually dial. Kept deliberately loose —
 * these are small Ontario businesses taking bookings by phone, and rejecting a
 * number because of its punctuation helps nobody.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(10, 'Enter a phone number an operator can reach you on.')
  .max(20, 'That phone number is too long.')
  .regex(/^[+()\-.\s\d]+$/, 'Use digits, spaces, and + ( ) - only.');

export const profileSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, 'Enter the name the driver should look for.')
    .max(120, 'That name is too long.'),
  phone: phoneSchema,
  // Optional, and shown to the operator at approval. Free text rather than a
  // fixed list: passengers describe themselves in their own words.
  gender: z.string().trim().max(40, 'Keep this short.').optional().or(z.literal('')),
  accommodation_notes: z
    .string()
    .trim()
    .max(500, 'Keep this under 500 characters.')
    .optional()
    .or(z.literal('')),
});

export type ProfileInput = z.infer<typeof profileSchema>;
