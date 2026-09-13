/**
 * Account types — which hat a signed-in person is wearing.
 *
 * One person has one login. What they *can* be comes from what they are: a
 * platform admin, a member of a business (owner or staff run it; a driver
 * drives for it), and a passenger if that is switched on. When they can be more
 * than one, they choose at sign-in, and the choice decides what they see, which
 * sections they may open, and the colour of the whole app.
 *
 * The choice is a convenience layered on top of real permissions, never a
 * replacement for them. RLS keeps permitting what the person actually is.
 *
 * Pure, so it can be tested without a request: the cookie is read and written
 * in `lib/auth/mode-session.ts`.
 */

import type { OperatorMemberRole } from '@/lib/supabase/database.types';

/** Most responsibility first — the order the picker lists them in. */
export const ACCOUNT_MODES = ['admin', 'operator', 'driver', 'passenger'] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

export const MODE_COOKIE = 'corridor_mode';

export const MODE_LABEL: Record<AccountMode, string> = {
  admin: 'Admin',
  operator: 'Operator',
  driver: 'Driver',
  passenger: 'Passenger',
};

export const MODE_BLURB: Record<AccountMode, string> = {
  admin: 'Vet operators and look after the platform.',
  operator: 'Run your business: requests, departures, fares and team.',
  driver: 'Your trips and who is in the van.',
  passenger: 'Search departures and book a seat for yourself.',
};

export type ModeViewer = {
  isAdmin: boolean;
  memberships: { operator_id: string; role: OperatorMemberRole }[];
  profile: { passenger_enabled: boolean; drives_enabled: boolean } | null;
};

export function isAccountMode(value: unknown): value is AccountMode {
  return typeof value === 'string' && (ACCOUNT_MODES as readonly string[]).includes(value);
}

/** Every account type this person has, most responsibility first. */
export function availableModes(viewer: ModeViewer): AccountMode[] {
  const roles = viewer.memberships.map((membership) => membership.role);
  const modes: AccountMode[] = [];

  if (viewer.isAdmin) modes.push('admin');
  if (roles.includes('owner') || roles.includes('staff')) modes.push('operator');
  // An invited driver drives. An owner drives only once they switch it on.
  if (roles.includes('driver') || (roles.includes('owner') && viewer.profile?.drives_enabled)) {
    modes.push('driver');
  }
  if (viewer.profile?.passenger_enabled ?? true) modes.push('passenger');

  // Nobody is left with nothing: set_account_mode() refuses to switch off a
  // plain passenger's only type, so this is a belt for a row that predates it.
  return modes.length > 0 ? modes : ['passenger'];
}

export type ModeToggle = { mode: 'passenger' | 'driver'; enabled: boolean };

/**
 * What this person may switch on or off for themselves: only what sits below
 * a role they already hold. The same rule `set_account_mode()` enforces.
 */
export function toggleableModes(viewer: ModeViewer): ModeToggle[] {
  const roles = viewer.memberships.map((membership) => membership.role);
  const toggles: ModeToggle[] = [];

  if (roles.includes('owner')) {
    toggles.push({ mode: 'driver', enabled: Boolean(viewer.profile?.drives_enabled) });
  }
  if (viewer.isAdmin || roles.length > 0) {
    toggles.push({ mode: 'passenger', enabled: viewer.profile?.passenger_enabled ?? true });
  }

  return toggles;
}

/**
 * The active account type: the one chosen, if they still have it; the only
 * one, if they have just one; otherwise null, meaning ask them.
 */
export function resolveMode(viewer: ModeViewer, chosen: string | undefined): AccountMode | null {
  const modes = availableModes(viewer);
  if (isAccountMode(chosen) && modes.includes(chosen)) return chosen;
  return modes.length === 1 ? modes[0]! : null;
}

/** The account type a path belongs to, or null for pages every type shares. */
export function modeForPath(path: string): AccountMode | null {
  const pathname = path.split(/[?#]/)[0] ?? '';
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  if (under('/admin')) return 'admin';
  if (under('/operator')) return 'operator';
  if (under('/driver')) return 'driver';
  if (under('/my-rides')) return 'passenger';
  return null;
}

/** Where an account type starts. */
export function homeFor(viewer: ModeViewer, mode: AccountMode): string {
  switch (mode) {
    case 'admin':
      return '/admin';
    case 'operator': {
      const staffing = viewer.memberships.find(
        (membership) => membership.role === 'owner' || membership.role === 'staff',
      );
      return staffing ? `/operator/${staffing.operator_id}` : '/';
    }
    case 'driver':
      return '/driver';
    case 'passenger':
      return '/';
  }
}

/**
 * Where to go once a type is chosen: back to `next` if it belongs to that type
 * or is shared by all of them, otherwise that type's home. The bare home page
 * counts as nowhere in particular — it is only ever a default.
 */
export function destinationFor(viewer: ModeViewer, mode: AccountMode, next: string | null | undefined): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && next !== '/') {
    const owner = modeForPath(next);
    if (owner === null || owner === mode) return next;
  }
  return homeFor(viewer, mode);
}
