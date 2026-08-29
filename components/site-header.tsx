import Link from 'next/link';

import { signOut } from '@/lib/auth/actions';
import { getViewer } from '@/lib/auth/session';
import { ButtonLink } from '@/components/ui';

/**
 * One header across every surface. The links a person sees are the surfaces
 * they actually have: a passenger who also drives for an operator gets both,
 * and nobody gets a dashboard they cannot open.
 */
export async function SiteHeader() {
  const viewer = await getViewer();

  const staffing = viewer?.memberships.filter((m) => m.role === 'owner' || m.role === 'staff') ?? [];
  const drives = viewer?.memberships.some((m) => m.role === 'driver') ?? false;

  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight text-ink-900">
          Corridor
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-sm">
          {viewer ? (
            <>
              <Link
                href="/my-rides"
                className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              >
                My rides
              </Link>

              {staffing.map((membership) => (
                <Link
                  key={membership.operator_id}
                  href={`/operator/${membership.operator_id}`}
                  className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                >
                  {membership.operator?.name ?? 'Operator'}
                </Link>
              ))}

              {drives ? (
                <Link
                  href="/driver"
                  className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                >
                  Driving
                </Link>
              ) : null}

              {viewer.isAdmin ? (
                <Link
                  href="/admin"
                  className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                >
                  Admin
                </Link>
              ) : null}

              <Link
                href="/profile"
                className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              >
                Profile
              </Link>

              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="rounded-lg px-3 py-2 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              >
                Sign in
              </Link>
              <ButtonLink href="/sign-up" size="sm">
                Create account
              </ButtonLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
