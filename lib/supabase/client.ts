'use client';

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from './database.types';
import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * Browser client. Used only for auth (sign-in, sign-out, OAuth redirect) and
 * realtime. Reads go through Server Components and writes through Server
 * Actions, so this client should never be the thing fetching booking data.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
