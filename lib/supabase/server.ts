import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from './database.types';
import { SESSION_COOKIE_OPTIONS, supabaseAnonKey, supabaseUrl } from './env';

/**
 * Request-scoped client carrying the caller's session, so every query runs
 * under RLS as that user. This is the default client for reads in Server
 * Components and for writes in Server Actions.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so dropping the write here is safe.
        }
      },
    },
  });
}
