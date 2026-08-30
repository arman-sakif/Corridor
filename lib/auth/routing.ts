import type { OperatorMemberRole } from '@/lib/supabase/database.types';

import type { Viewer } from './session';

/**
 * The roles that can be behind the wheel, and therefore the roles allowed into
 * `/driver`.
 *
 * Owners are on this list because they drive. A small operator is often one
 * person with a van, and the departure screen offers owners alongside drivers
 * when assigning one — so a guard that admitted only `driver` would lock an
 * owner out of the manifest for a trip they are about to make.
 *
 * Staff are not: they run the office, and the assignment screen does not offer
 * them either. Keep this list and that screen in step — they are the same
 * question asked from two directions, which is why both now read it from here.
 */
export const DRIVING_ROLES: OperatorMemberRole[] = ['driver', 'owner'];

export function canDrive(viewer: Viewer): boolean {
  return viewer.memberships.some((m) => DRIVING_ROLES.includes(m.role));
}

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
