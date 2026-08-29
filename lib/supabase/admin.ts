import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { supabaseServiceRoleKey, supabaseUrl } from './env';

/**
 * Service-role client. Bypasses RLS entirely, so every call site must do its
 * own authorisation check first.
 *
 * Legitimate uses are narrow: departure generation, the hold sweep, and reads
 * a policy cannot express without recursing. Anything a user triggers should
 * use the request-scoped client in `./server` instead.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
