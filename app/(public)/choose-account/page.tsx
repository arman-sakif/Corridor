import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AccountPicker } from '@/components/account-picker';
import { signOut } from '@/lib/auth/actions';
import { activeMode } from '@/lib/auth/mode-session';
import { MODE_LABEL, availableModes, destinationFor, isAccountMode } from '@/lib/auth/modes';
import { safeRedirectPath } from '@/lib/auth/routing';
import { requireViewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';

export const metadata: Metadata = { title: 'Log in as' };

/**
 * The pop-up at sign-in for someone with more than one account type, and the
 * stop on the way into a section that belongs to a type they are not using.
 */
export default async function ChooseAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; want?: string }>;
}) {
  const params = await searchParams;
  const viewer = await requireViewer('/choose-account');
  const modes = availableModes(viewer);
  const next = params.next ? safeRedirectPath(params.next, '/') : null;

  // Nothing to choose between.
  if (modes.length === 1) redirect(dynamicRoute(destinationFor(viewer, modes[0]!, next)));

  const current = await activeMode(viewer);
  const want = isAccountMode(params.want) && modes.includes(params.want) ? params.want : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-account-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-hero"
      >
        <h1 id="choose-account-title" className="text-lg font-semibold text-ink-900">
          Log in as
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          {want
            ? `That page belongs to your ${MODE_LABEL[want].toLowerCase()} account. Choose it to carry on, or pick another.`
            : 'You have more than one account on Corridor, all with this email and password. You can switch any time from the header.'}
        </p>

        <div className="mt-5">
          <AccountPicker modes={modes} current={current} next={next} />
        </div>

        <form action={signOut} className="mt-4 text-center">
          <button
            type="submit"
            className="text-sm text-ink-500 transition-colors hover:text-ink-900"
          >
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
