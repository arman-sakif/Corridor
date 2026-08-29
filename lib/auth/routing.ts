import type { Viewer } from './session';

/**
 * Where a user lands after signing in.
 *
 * Most people on this platform are passengers, so search is the default. Only
 * a user who is *nothing but* an admin, an operator, or a driver skips it —
 * anyone who is also a passenger can walk back to search from the header.
 */
export function landingPathFor(viewer: Viewer): string {
  if (viewer.isAdmin) return '/admin';

  const staffing = viewer.memberships.find((m) => m.role === 'owner' || m.role === 'staff');
  if (staffing) return `/operator/${staffing.operator_id}`;

  const driving = viewer.memberships.find((m) => m.role === 'driver');
  if (driving) return '/driver';

  return '/';
}

/**
 * Guards the `next` parameter on sign-in. An open redirect here would let a
 * phishing link bounce a freshly authenticated user to another origin.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
