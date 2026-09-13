import { requireMode } from '@/lib/auth/mode-session';

/**
 * My rides belongs to the passenger account. Profile, notifications and
 * feedback sit beside it in this route group but are shared by every type, so
 * the guard lives here rather than on the group.
 */
export default async function MyRidesLayout({ children }: { children: React.ReactNode }) {
  await requireMode('passenger', '/my-rides');
  return children;
}
