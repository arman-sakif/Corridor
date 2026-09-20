import type { Metadata } from 'next';
import Link from 'next/link';

import { safeRedirectPath } from '@/lib/auth/routing';
import { dynamicRoute } from '@/lib/routes';
import { Alert, ButtonLink, Card } from '@/components/ui';
import { IconSettings } from '@/components/icons';

export const metadata: Metadata = { title: 'Google sign-in is not ready yet' };

/**
 * Where the greyed-out Google button leads. It exists so a press lands
 * somewhere that says what happened, rather than doing nothing at all.
 */
export default async function GoogleUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeRedirectPath((await searchParams).next, '/');
  const query = `?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-ink-150 text-lg text-ink-500">
          <IconSettings />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Still under construction
        </h1>
      </div>

      <div className="mt-5">
        <Alert tone="warn">Google sign-in is not available in this version of Corridor.</Alert>
      </div>

      <Card className="mt-6 p-6">
        <p className="text-sm text-ink-600">
          It is coming, and nothing is wrong with your Google account. Until it is switched on, use
          your email address and a password — it reaches exactly the same account, and you can add
          Google to it later.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <ButtonLink href={dynamicRoute(`/sign-in${query}`)} size="lg" className="flex-1">
            Sign in with email
          </ButtonLink>
          <ButtonLink
            href={dynamicRoute(`/sign-up${query}`)}
            tone="secondary"
            size="lg"
            className="flex-1"
          >
            Create an account
          </ButtonLink>
        </div>
      </Card>

      <p className="mt-6 text-center text-sm text-ink-600">
        Forgotten your password?{' '}
        <Link
          href={dynamicRoute(`/forgot-password${query}`)}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Get a sign-in code by email
        </Link>
      </p>
    </div>
  );
}
