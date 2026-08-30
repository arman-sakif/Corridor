'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Marking notifications read.
 *
 * Through an RPC rather than an update, because the table is read-only to the
 * API on purpose: RLS governs rows, not columns, so a policy permitting "your
 * own row" would also permit rewriting the subject and body of a message
 * somebody else sent you. `mark_notifications_read()` can set `read_at` and
 * nothing else. See 20260830000018_notifications.sql.
 */
export async function markNotificationsRead(formData: FormData): Promise<void> {
  await requireViewer('/notifications');

  const id = formData.get('notification_id')?.toString();

  const supabase = await createClient();
  // No ids means everything still unread, which is what "Mark all read" sends.
  await supabase.rpc('mark_notifications_read', { p_ids: id ? [id] : null });

  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
}
