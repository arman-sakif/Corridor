import Link from 'next/link';

import { buttonClass, EmptyState } from '@/components/ui';
import { IconSearch } from '@/components/icons';

/**
 * A 404 here usually means a booking, departure or route that is not yours to
 * see — RLS returns nothing and the page calls `notFound()` rather than
 * admitting the row exists. So the copy says "not here", never "not allowed".
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <div className="w-full">
        <EmptyState
          icon={<IconSearch />}
          title="We could not find that"
          action={
            <Link href="/" className={buttonClass('primary')}>
              Search for a ride
            </Link>
          }
        >
          The page may have moved, or it may belong to someone else&rsquo;s account.
        </EmptyState>
      </div>
    </main>
  );
}
