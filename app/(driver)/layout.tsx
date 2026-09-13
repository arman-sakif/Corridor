import { requireMode } from '@/lib/auth/mode-session';

/**
 * The guard for the driver surface, and nothing else.
 *
 * There was once no layout here at all, and any signed-in passenger could open
 * `/driver` and get an empty dashboard. Nothing leaked — RLS matches only a
 * driver's own assignments — but "you have no trips today" and "this is not
 * your screen" read identically, and authorisation should be stated rather
 * than inferred from a policy happening to return no rows.
 *
 * `requireMode` states it: someone without the driver account type is sent to
 * their own home, and someone who has it but is using another is asked to
 * switch. An owner has the driver type once they switch driving on in Profile.
 *
 * Chrome deliberately stays on the pages: the two of them use different
 * widths, and hoisting the shell here would quietly restyle one of them.
 */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requireMode('driver', '/driver');
  return children;
}
