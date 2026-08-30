import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ForgotPasswordForm } from './forgot-password-form';
import { landingPathFor, safeRedirectPath } from '@/lib/auth/routing';
import { getViewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';
import { Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Forgotten password' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(dynamicRoute(safeRedirectPath(params.next, landingPathFor(viewer))));

  const next = safeRedirectPath(params.next, '/');

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Forgotten password</h1>
      <p className="mt-1 text-sm text-ink-600">
        Two ways back in. A code signs you in right now; a link lets you set a new password.
      </p>

      <Card className="mt-6 p-6">
        <ForgotPasswordForm next={next} />
      </Card>
    </div>
  );
}
