import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { safeRedirectPath } from '@/lib/auth/routing';
import { createClient } from '@/lib/supabase/server';

/**
 * Where a link we sent ourselves comes back to.
 *
 * This sits beside /auth/callback rather than inside it because the two carry
 * different credentials. Google and Supabase's own confirmation emails arrive
 * with a PKCE `code`, exchanged by `exchangeCodeForSession`. A link minted by
 * `auth.admin.generateLink` and posted through Resend arrives with a
 * `token_hash` instead, and is redeemed by `verifyOtp`. Feeding one to the
 * other fails with an error that reads like an expired link, which is a
 * miserable thing to debug at the moment someone is locked out.
 */

const ALLOWED: EmailOtpType[] = ['recovery', 'magiclink', 'email', 'signup', 'invite'];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get('next'), '/update-password');

  if (!tokenHash || !type || !ALLOWED.includes(type)) {
    return NextResponse.redirect(`${origin}/sign-in?error=expired`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  // A used link and an expired link are the same thing to the person holding
  // it, and both are fixed the same way: ask for another.
  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
