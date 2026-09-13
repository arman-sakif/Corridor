import type { OperatorMemberRole } from '@/lib/supabase/database.types';

/**
 * The roles that can be behind the wheel, and therefore the roles the
 * departure screen offers when assigning a driver.
 *
 * Owners are on this list because they drive. A small operator is often one
 * person with a van. Staff are not: they run the office. Whether a person may
 * open `/driver` is a separate question, answered by account types in
 * `lib/auth/modes.ts` — an owner gets there once they switch driving on.
 */
export const DRIVING_ROLES: OperatorMemberRole[] = ['driver', 'owner'];

/**
 * Guards the `next` parameter on sign-in. An open redirect here would let a
 * phishing link bounce a freshly authenticated user to another origin.
 *
 * Where someone lands when there is no `next` depends on which account type
 * they are using: see `homePath` and `afterSignIn` in `lib/auth/mode-session.ts`.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
