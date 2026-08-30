import { z } from 'zod';

/**
 * Complaints about a trip, and feedback about the product.
 *
 * Both are free text by nature — somebody is telling you something you did not
 * anticipate, which is the entire point — so the categories are there to sort
 * the pile, not to constrain what can be said.
 */

export const reportSchema = z.object({
  booking_id: z.uuid(),
  category: z.enum(
    ['driving', 'lateness', 'vehicle', 'conduct', 'overcharged', 'safety', 'other'],
    { message: 'Choose what went wrong.' },
  ),
  note: z
    .string()
    .trim()
    .min(10, 'A sentence or two, so the operator knows what to look into.')
    .max(2000, 'Keep this under 2000 characters.'),
});

export const resolveReportSchema = z.object({
  report_id: z.uuid(),
  operator_id: z.uuid().optional(),
  resolution: z
    .string()
    .trim()
    .max(2000, 'Keep this under 2000 characters.')
    .optional()
    .or(z.literal('')),
});

export const feedbackSchema = z.object({
  kind: z.enum(['idea', 'problem', 'praise', 'other'], { message: 'Choose one.' }),
  message: z
    .string()
    .trim()
    .min(5, 'Tell us a little more.')
    .max(2000, 'Keep this under 2000 characters.'),
});
