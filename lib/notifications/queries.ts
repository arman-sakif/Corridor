import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/database.types';

/**
 * Reading the in-app notification list.
 *
 * Both of these run as the signed-in user, so `notifications_select_own` is
 * what limits them to their own rows — the `user_id` filter in the query is
 * the second statement of the same rule, not the enforcement.
 */

export type Notification = Tables<'notifications'>;

/** Newest first. PostgREST caps a select at 1000 rows, so the page is explicit. */
export async function listNotifications(userId: string, limit = 50): Promise<Notification[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data ?? [];
}

/**
 * The header badge, so it runs on nearly every page load — `head: true` asks
 * for the count without the rows, and `notifications_unread_idx` covers it.
 */
export async function unreadCount(userId: string): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  return count ?? 0;
}
