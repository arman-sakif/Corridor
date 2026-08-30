import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <footer className="mt-16 border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <div>
              <p className="font-semibold text-ink-900">Corridor</p>
              <p className="mt-1 max-w-md text-sm text-ink-500">
                Booking software for Ontario rideshare operators. Each business runs its own
                vehicles, sets its own fares, and holds its own licensing and insurance.
              </p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Link href="/operators" className="text-ink-600 transition-colors hover:text-brand-700">
                Browse operators
              </Link>
              <Link
                href="/for-operators"
                className="text-ink-600 transition-colors hover:text-brand-700"
              >
                List your business
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
