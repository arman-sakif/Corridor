import { redirect } from 'next/navigation';

import { canDrive } from '@/lib/auth/routing';
import { requireViewer } from '@/lib/auth/session';

/**
 * The guard for the driver surface, and nothing else.
 *
 * There was no layout here at all. The pages called `requireViewer`, so a
 * signed-out visitor was sent to sign in — but any signed-in passenger could
 * open `/driver` and get the page. Nothing leaked: the queries run under RLS,
 * `departures_select_driver` matches only their own assignments, and a
 * stranger has none. The result was an empty dashboard rather than a refusal.
 *
 * Which is the wrong answer to give. "You have no trips today" and "this is
 * not your screen" read identically, and leaning on RLS to produce that
 * emptiness means the day someone adds a query that forgets to filter, the
 * page starts answering. Authorisation should be stated, not inferred from a
 * policy elsewhere happening to return no rows.
 *
 * Chrome deliberately stays on the pages: the two of them use different
 * widths, and hoisting the shell here would quietly restyle one of them. This
 * layout only decides who gets in.
 */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer('/driver');

  // Home rather than notFound(): a passenger who lands here by a stale link or
  // a guessed URL has done nothing wrong, and pretending the route does not
  // exist would be a lie to the operator staff who can see it in the nav.
  if (!canDrive(viewer)) redirect('/');

  return children;
}
