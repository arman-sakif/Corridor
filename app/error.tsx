'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Button, buttonClass, EmptyState } from '@/components/ui';
import { IconWarning } from '@/components/icons';

/**
 * Where a refused query now lands.
 *
 * Reads never default a failure to an empty list any more — `lib/supabase/rows`
 * throws instead — so this page is the visible half of that decision. It says
 * the true thing ("we could not load this") rather than the plausible false one
 * ("there is nothing here"), and offers the two moves that ever help: try
 * again, or go somewhere that works.
 *
 * The reason itself stays server-side. React hands the browser a digest, not
 * the message, and that is the right split: the reader cannot act on
 * "PGRST201", and the person who can is reading the server log.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <div className="w-full">
        <EmptyState
          icon={<IconWarning />}
          title="We could not load this page"
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={reset}>Try again</Button>
              <Link href="/" className={buttonClass('secondary')}>
                Go to search
              </Link>
            </div>
          }
        >
          Something went wrong on our side, not yours. Nothing you have booked is affected.
          {error.digest ? (
            <span className="mt-2 block text-xs text-ink-400">Reference {error.digest}</span>
          ) : null}
        </EmptyState>
      </div>
    </main>
  );
}
