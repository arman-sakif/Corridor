import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-ink-500">
          <span>Corridor — intercity rides across Ontario.</span>
          <Link href="/operators" className="hover:text-ink-800">
            Browse operators
          </Link>
          <Link href="/for-operators" className="hover:text-ink-800">
            List your business
          </Link>
        </div>
      </footer>
    </div>
  );
}
