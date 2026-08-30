import type { Metadata } from 'next';

import { UpdatePasswordForm } from './update-password-form';
import { safeRedirectPath } from '@/lib/auth/routing';
import { requireViewer } from '@/lib/auth/session';
import { Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Set a new password' };

/**
 * Reached by opening a reset link, which redeems into a session at
 * /auth/confirm — so holding a session is the authorisation, and
 * `requireViewer` is the whole check. It is a normal page otherwise: someone
 * already signed in can come here to change their password deliberately.
 */
export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const viewer = await requireViewer('/update-password');
  const next = safeRedirectPath(params.next, '/');

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Set a new password</h1>
      <p className="mt-1 text-sm text-ink-600">
        You will stay signed in on this device. Anywhere else stays signed in too, so sign out
        there if you were locked out by someone else.
      </p>

      <Card className="mt-6 p-6">
        <UpdatePasswordForm
          next={next}
          personal={[viewer.email ?? '', viewer.profile?.full_name ?? '']}
        />
      </Card>
    </div>
  );
}
