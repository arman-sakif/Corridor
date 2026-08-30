import { z } from 'zod';

import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password-strength';

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

/**
 * Length is the whole policy. The signup form shows a strength meter beside
 * this field, but a suggestion and a rule are different things: telling
 * someone their passphrase is "medium" is helpful, refusing it is not.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(72, 'Passwords cannot be longer than 72 characters.');

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

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter the name the driver should look for.')
  .max(120, 'That name is too long.');

export const signInSchema = z.object({
  email: emailSchema,
  // Never re-validate an existing password: the rules may have changed since
  // it was set, and "your password is too short" at the sign-in screen is a
  // dead end.
  password: z.string().min(1, 'Enter your password.'),
  next: z.string().optional(),
});

/**
 * Everything an operator needs to approve a booking, asked once. Collecting
 * the name and phone here rather than on a second screen is the difference
 * between one form and two, and the phone number is not optional in practice —
 * an operator cannot approve a stranger they have no way to reach.
 */
export const signUpSchema = z.object({
  full_name: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  next: z.string().optional(),
});

/** Which way someone wants to get back into an account they are locked out of. */
export const recoveryRequestSchema = z.object({
  email: emailSchema,
  method: z.enum(['code', 'link'], { message: 'Choose a code or a link.' }),
  next: z.string().optional(),
});

/**
 * The code length is a project setting (`otp_length`), not a constant — this
 * Supabase project issues eight digits while the CLI default is six. Pinning
 * the schema to one of them rejects every real code the moment the other is
 * configured, so accept the range GoTrue allows and let it judge the value.
 * Spaces are stripped because people paste codes out of an email with them.
 */
export const loginCodeSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{6,10}$/, 'Enter the code from the email — digits only.')),
  next: z.string().optional(),
});

export const updatePasswordSchema = z.object({
  password: passwordSchema,
  next: z.string().optional(),
});

export const profileSchema = z.object({
  full_name: fullNameSchema,
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
