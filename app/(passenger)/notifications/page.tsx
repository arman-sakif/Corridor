import type { Metadata } from 'next';
import Link from 'next/link';

import { markNotificationsRead } from '@/lib/notifications/actions';
import { listNotifications, unreadCount } from '@/lib/notifications/queries';
import { requireViewer } from '@/lib/auth/session';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { IconBell } from '@/components/icons';
import { dynamicRoute } from '@/lib/routes';
import { formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Notifications' };

/**
 * Everything the platform has told this person, whatever their role.
 *
 * It lives here rather than behind a role check because everyone has one: a
 * passenger hears their seat was approved, an operator hears a seat was
 * requested, and someone who is both sees both in one list.
 *
 * This is the channel that actually reaches people. Email goes through
 * Resend's sandbox sender until a domain is verified, which delivers to one
 * address and refuses the rest — so for every passenger who is not the
 * developer, this page is the only place the news arrives.
 */
export default async function NotificationsPage() {
  const viewer = await requireViewer('/notifications');

  const [notifications, unread] = await Promise.all([
    listNotifications(viewer.userId),
    unreadCount(viewer.userId),
  ]);

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `${unread} unread.`
            : notifications.length > 0
              ? 'You are up to date.'
              : undefined
        }
        action={
          unread > 0 ? (
            <form action={markNotificationsRead}>
              <Button type="submit" tone="secondary" size="sm">
                Mark all read
              </Button>
            </form>
          ) : null
        }
      />

      {notifications.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={<IconBell />}
            title="Nothing yet"
            action={<Link href="/search">Find a ride</Link>}
          >
            When you request a seat, or an operator answers one, it turns up here.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => {
            const unreadRow = !notification.read_at;

            return (
              <li key={notification.id}>
                <Card className={unreadRow ? 'p-4 ring-brand-200' : 'p-4'}>
                  <div className="flex items-start gap-3">
                    {/*
                      A dot rather than a badge: the list is scanned, and an
                      unread row needs to be findable without being read.
                    */}
                    <span
                      aria-hidden="true"
                      className={
                        'mt-1.5 size-2 shrink-0 rounded-full ' +
                        (unreadRow ? 'bg-brand-600' : 'bg-transparent')
                      }
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-ink-900">
                          {notification.subject}
                          {unreadRow ? <span className="sr-only"> (unread)</span> : null}
                        </span>
                        <span className="text-xs text-ink-500">
                          {formatRelative(notification.created_at)}
                        </span>
                      </div>

                      <p className="mt-1 text-sm text-ink-600">{notification.body}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                        {notification.link ? (
                          <Link
                            href={dynamicRoute(notification.link)}
                            className="font-medium text-brand-600 hover:text-brand-700"
                          >
                            Open
                          </Link>
                        ) : null}

                        {unreadRow ? (
                          <form action={markNotificationsRead}>
                            <input
                              type="hidden"
                              name="notification_id"
                              value={notification.id}
                            />
                            <button
                              type="submit"
                              className="font-medium text-ink-500 hover:text-ink-900"
                            >
                              Mark read
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
