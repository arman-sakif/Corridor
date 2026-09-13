import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  MODE_COOKIE,
  availableModes,
  destinationFor,
  resolveMode,
  type AccountMode,
} from '@/lib/auth/modes';
import { requireViewer, type Viewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';

/**
 * The active account type, carried in a cookie and re-checked on every request.
 *
 * The cookie is only a preference. `resolveMode` throws it away the moment it
 * names a type the person no longer has — an owner who switched driving off, a
 * driver removed from a team — so a stale cookie can never hold a door open.
 */

/** As long as a session lasts, so choosing once is choosing until sign-out. */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export async function activeMode(viewer: Viewer): Promise<AccountMode | null> {
  const store = await cookies();
  return resolveMode(viewer, store.get(MODE_COOKIE)?.value);
}

/** Server Actions and Route Handlers only: a cookie cannot be written mid-render. */
export async function rememberMode(mode: AccountMode): Promise<void> {
  const store = await cookies();
  store.set(MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function forgetMode(): Promise<void> {
  const store = await cookies();
  store.delete(MODE_COOKIE);
}

/** The "Log in as" picker, remembering where the person was headed. */
export function chooserPath(next?: string | null, want?: AccountMode): string {
  const query = new URLSearchParams();
  if (next && next !== '/') query.set('next', next);
  if (want) query.set('want', want);
  const search = query.toString();
  return search ? `/choose-account?${search}` : '/choose-account';
}

/**
 * Where someone goes the moment they sign in. Signing in always asks afresh:
 * a person with more than one account type is shown the picker, whatever they
 * chose last time. Someone with one type never sees it.
 */
export async function afterSignIn(viewer: Viewer, next: string | null | undefined): Promise<string> {
  const modes = availableModes(viewer);

  if (modes.length === 1) {
    await rememberMode(modes[0]!);
    return destinationFor(viewer, modes[0]!, next);
  }

  await forgetMode();
  return chooserPath(next);
}

/** Where a signed-in person belongs right now: their type's home, or the picker. */
export async function homePath(viewer: Viewer, next?: string | null): Promise<string> {
  const mode = await activeMode(viewer);
  return mode ? destinationFor(viewer, mode, next) : chooserPath(next);
}

/**
 * The guard for a section that belongs to one account type.
 *
 * Someone who does not have that type at all is sent home in the type they are
 * in. Someone who has it but is wearing another hat is asked to switch — the
 * page is theirs, they just came to it as someone else.
 */
export async function requireMode(mode: AccountMode, returnTo: string): Promise<Viewer> {
  const viewer = await requireViewer(returnTo);

  if (!availableModes(viewer).includes(mode)) {
    redirect(dynamicRoute(await homePath(viewer)));
  }

  if ((await activeMode(viewer)) !== mode) {
    redirect(dynamicRoute(chooserPath(returnTo, mode)));
  }

  return viewer;
}
