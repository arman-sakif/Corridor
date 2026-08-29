import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import type { Database } from './database.types';
import { supabaseAnonKey, supabaseUrl } from './env';

/**
 * Refreshes the auth session on every request and writes the rotated cookies
 * onto the response. Without this, an expired access token would log the user
 * out mid-session even though the refresh token is still good.
 *
 * It deliberately does no authorisation. Route protection lives in layouts and
 * Server Actions, where the check is close to the thing being protected.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() revalidates the token with Supabase. getSession() would trust
  // the cookie, which the client can forge.
  await supabase.auth.getUser();

  return response;
}
