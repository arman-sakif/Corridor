/**
 * What a locked-out person is told, and for how long.
 *
 * The policy half of the sign-in throttle, kept apart from the counting in
 * `./throttle.ts` for the same reason `modes.ts` is kept apart from
 * `mode-session.ts`: this is pure, so it is tested without a database or a
 * request behind it.
 */

/** How far back the counters look. */
export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Per account, and deliberately tight: ten wrong passwords in a quarter of an
 * hour is nobody's honest Tuesday.
 */
export const MAX_PER_EMAIL = 10;

/**
 * Per caller, and deliberately loose. A household, an office and a phone
 * network all share one address, so this has to clear a family getting back
 * into their accounts on one wifi while still stopping a script.
 */
export const MAX_PER_IP = 40;

/**
 * When the oldest attempt in the window ages out — which is the soonest this
 * caller gets another go.
 */
export function retryAfterMinutes(
  oldestAttemptAt: string | null,
  now: Date = new Date(),
  windowMs: number = WINDOW_MS,
): number {
  if (!oldestAttemptAt) return 0;
  const freeAt = new Date(oldestAttemptAt).getTime() + windowMs;
  return Math.max(1, Math.ceil((freeAt - now.getTime()) / 60_000));
}

/** Says what to do next, because a lockout with no way forward is a dead end. */
export function lockoutMessage(minutes: number): string {
  const wait = minutes <= 1 ? 'a minute' : `${minutes} minutes`;
  return (
    `Too many sign-in attempts. Try again in ${wait}, ` +
    'or reset your password if you have forgotten it.'
  );
}
