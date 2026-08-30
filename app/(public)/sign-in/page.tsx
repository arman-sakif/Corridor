import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignInForm } from './sign-in-form';
import { landingPathFor, safeRedirectPath } from '@/lib/auth/routing';
import { getViewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';
import { Alert, Card } from '@/components/ui';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * A redirect back here can only carry a code in the URL, so the sentence that
 * explains it lives on this side. Each one says what to do next: "try again"
 * on its own leaves someone pressing the same button that just failed.
 */
const ERRORS: Record<string, string> = {
  google: 'Google sign-in did not complete. Try again, or use your email and password below.',
  callback: 'That sign-in link did not work. Ask for a new one and try again.',
  expired:
    'That link has expired or has already been used. Ask for a new one from the forgotten-password screen.',
  default: 'That sign-in did not complete. Try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(dynamicRoute(safeRedirectPath(params.next, landingPathFor(viewer))));

  const next = safeRedirectPath(params.next, '/');

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in</h1>
      <p className="mt-1 text-sm text-ink-600">
        To request a seat, you need an account so the operator can reach you.
      </p>

      {params.error ? (
        <div className="mt-4">
          <Alert tone="bad">{ERRORS[params.error] ?? ERRORS.default}</Alert>
        </div>
      ) : null}

      <Card className="mt-6 p-6">
        <SignInForm next={next} />
      </Card>

      <p className="mt-6 text-center text-sm text-ink-600">
        No account yet?{' '}
        <Link
          href={`/sign-up?next=${encodeURIComponent(next)}`}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
