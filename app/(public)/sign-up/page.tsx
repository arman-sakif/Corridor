import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignUpForm } from './sign-up-form';
import { landingPathFor, safeRedirectPath } from '@/lib/auth/routing';
import { getViewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';
import { Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignUpPage({
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
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your account</h1>
      <p className="mt-1 text-sm text-ink-600">
        Email and a password is all it takes. You can add your name and phone number next.
      </p>

      <Card className="mt-6 p-6">
        <SignUpForm next={next} />
      </Card>

      <p className="mt-6 text-center text-sm text-ink-600">
        Already have an account?{' '}
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
