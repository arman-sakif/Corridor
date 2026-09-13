import Link from 'next/link';

import { AccountPicker } from '@/components/account-picker';
import { SwitchAccount } from '@/components/switch-account';
import { signOut } from '@/lib/auth/actions';
import { activeMode } from '@/lib/auth/mode-session';
import { MODE_LABEL, availableModes, homeFor } from '@/lib/auth/modes';
import { getViewer } from '@/lib/auth/session';
import { unreadCount } from '@/lib/notifications/queries';
import { ButtonLink } from '@/components/ui';
import { NavLink } from '@/components/nav';
import { IconBell, IconLogo } from '@/components/icons';
import { dynamicRoute } from '@/lib/routes';

/**
 * One header, shaped by the account type in use. A passenger sees their rides,
 * an operator their business, a driver their trips, an admin the console — and
 * nobody sees another type's links, even when they have that type too. Switch
 * is how they get there.
 */
export async function SiteHeader() {
  const viewer = await getViewer();
  const mode = viewer ? await activeMode(viewer) : null;
  const modes = viewer ? availableModes(viewer) : [];

  const staffing = viewer?.memberships.filter((m) => m.role === 'owner' || m.role === 'staff') ?? [];
  const unread = viewer ? await unreadCount(viewer.userId) : 0;
  const home = viewer && mode ? homeFor(viewer, mode) : '/';

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link
          href={dynamicRoute(home)}
          className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 text-lg font-semibold tracking-tight text-ink-900 transition-colors hover:text-brand-700"
        >
          <IconLogo className="text-xl text-brand-600" />
          Corridor
        </Link>

        {/* Which hat, at a glance — only worth saying to someone with more than one. */}
        {mode && modes.length > 1 ? (
          <span className="hidden shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 sm:inline-flex">
            {MODE_LABEL[mode]}
          </span>
        ) : null}

        {/*
          A person with several links here on a phone has a nav wider than the
          screen. Scrolling it keeps every link reachable — sign out most of
          all, which once sat off the right-hand edge with no way to reach it.
        */}
        <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {viewer ? (
            <>
              {mode === 'passenger' ? <NavLink href="/my-rides">My rides</NavLink> : null}

              {mode === 'operator'
                ? staffing.map((membership) => (
                    <NavLink key={membership.operator_id} href={`/operator/${membership.operator_id}`}>
                      {membership.operator?.name ?? 'Operator'}
                    </NavLink>
                  ))
                : null}

              {mode === 'driver' ? <NavLink href="/driver">Driving</NavLink> : null}
              {mode === 'admin' ? <NavLink href="/admin">Admin</NavLink> : null}

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

              {modes.length > 1 ? (
                <SwitchAccount label={mode ? 'Switch' : 'Choose account'}>
                  <AccountPicker modes={modes} current={mode} />
                </SwitchAccount>
              ) : null}

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
