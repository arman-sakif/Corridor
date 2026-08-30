import Link from 'next/link';

import { signOut } from '@/lib/auth/actions';
import { getViewer } from '@/lib/auth/session';
import { unreadCount } from '@/lib/notifications/queries';
import { ButtonLink } from '@/components/ui';
import { NavLink } from '@/components/nav';
import { IconBell, IconLogo } from '@/components/icons';
import { dynamicRoute } from '@/lib/routes';

/**
 * One header across every surface. The links a person sees are the surfaces
 * they actually have: a passenger who also drives for an operator gets both,
 * and nobody gets a dashboard they cannot open.
 */
export async function SiteHeader() {
  const viewer = await getViewer();

  const staffing = viewer?.memberships.filter((m) => m.role === 'owner' || m.role === 'staff') ?? [];
  const drives = viewer?.memberships.some((m) => m.role === 'driver') ?? false;
  const unread = viewer ? await unreadCount(viewer.userId) : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 text-lg font-semibold tracking-tight text-ink-900 transition-colors hover:text-brand-700"
        >
          <IconLogo className="text-xl text-brand-600" />
          Corridor
        </Link>

        {/*
          A passenger who also drives for two operators has five links here,
          and on a phone that is wider than the screen. Scrolling the nav keeps
          every one of them reachable — sign out most of all, which sat off the
          right-hand edge with no way to get to it.
        */}
        <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {viewer ? (
            <>
              <NavLink href="/my-rides">My rides</NavLink>

              {staffing.map((membership) => (
                <NavLink key={membership.operator_id} href={`/operator/${membership.operator_id}`}>
                  {membership.operator?.name ?? 'Operator'}
                </NavLink>
              ))}

              {drives ? <NavLink href="/driver">Driving</NavLink> : null}
              {viewer.isAdmin ? <NavLink href="/admin">Admin</NavLink> : null}

              {/*
                The count is the point. Email reaches one address until a
                sending domain exists, so for most people this badge is the
                only sign that anything happened at all.
              */}
              <Link
                href="/notifications"
                aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                className="relative shrink-0 rounded-lg px-3 py-2 text-ink-600 transition-colors hover:bg-ink-150 hover:text-ink-900"
              >
                <IconBell className="text-lg" />
                {unread > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-1.5 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
                  >
                    {unread > 9 ? '9+' : unread}
                  </span>
                ) : null}
              </Link>
              <NavLink href="/feedback">Tell us</NavLink>
              <NavLink href="/profile">Profile</NavLink>

              <form action={signOut} className="shrink-0">
                <button
                  type="submit"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-150 hover:text-ink-900"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <NavLink href="/sign-in">Sign in</NavLink>
              <ButtonLink href={dynamicRoute('/sign-up')} size="sm">
                Create account
              </ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
