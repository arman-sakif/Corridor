'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Alert } from '@/components/ui';
import { dynamicRoute } from '@/lib/routes';

/**
 * The overdue warning that follows an operator around their dashboard.
 *
 * It hides itself on the billing page, which carries its own — otherwise that
 * page stacks two nearly identical banners and the first one offers to take
 * you where you already are.
 *
 * A client component only because it needs the pathname. The decision about
 * *whether* the operator is overdue is still made on the server.
 */
export function PastDueBanner({ operatorId }: { operatorId: string }) {
  const pathname = usePathname();
  const billing = `/operator/${operatorId}/billing`;

  if (pathname === billing) return null;

  return (
    <div className="mb-6">
      <Alert tone="warn">
        Your Corridor subscription is overdue. Nothing has stopped and your passengers see no
        difference —{' '}
        <Link href={dynamicRoute(billing)} className="font-medium underline">
          check your billing
        </Link>{' '}
        when you have a moment.
      </Alert>
    </div>
  );
}
