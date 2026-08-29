import { z } from 'zod';

/**
 * The shape every Server Action returns, so forms can render errors the same
 * way everywhere. Errors say what went wrong and how to fix it — never
 * "invalid input".
 */
export type FormState =
  | { status: 'idle' }
  | { status: 'success'; message?: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export const idleState: FormState = { status: 'idle' };

export function fail(message: string, fieldErrors?: Record<string, string>): FormState {
  return { status: 'error', message, fieldErrors };
}

export function succeed(message?: string): FormState {
  return { status: 'success', message };
}

/** First error per field — a form shows one message per input, not a list. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const flattened = z.flattenError(error);
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0];
    if (first) out[field] = first;
  }
  return out;
}

/**
 * Parses FormData against a schema. Repeated keys become arrays, so a
 * multi-checkbox group (days of week, for instance) arrives as one field.
 */
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { ok: true; data: z.output<S> } | { ok: false; state: FormState } {
  const raw: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key);
    raw[key] = values.length > 1 ? values : (values[0] as FormDataEntryValue);
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  return {
    ok: false,
    state: fail('Some details need fixing before this can be saved.', fieldErrorsOf(parsed.error)),
  };
}
