import type { Route } from 'next';

/**
 * `typedRoutes` checks every literal href against the real app directory,
 * which is worth keeping: a renamed folder should break the build, not the
 * site. It cannot check a path assembled at runtime, though — a `next=`
 * parameter off a query string, or an id interpolated with a query suffix.
 *
 * This is the one place those are admitted. Anything passed through here has
 * already been validated at runtime: `safeRedirectPath` rejects an off-site
 * target, and ids come from rows we just read. Do not reach for it to silence
 * a genuine typo.
 */
export function dynamicRoute(path: string): Route {
  return path as Route;
}

/**
 * An absolute URL on someone else's origin — the Google consent screen that
 * Supabase hands back, for instance. `redirect()` accepts one at runtime; the
 * route type just cannot know it is not a path.
 */
export function externalUrl(url: string): Route {
  return url as Route;
}
