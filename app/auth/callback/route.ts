import { NextResponse, type NextRequest } from 'next/server';

import { afterSignIn } from '@/lib/auth/mode-session';
import { safeRedirectPath } from '@/lib/auth/routing';
import { getViewer, profileIsComplete } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Where Supabase sends the user back after Google OAuth or an email
 * confirmation link. Exchanges the one-time code for a session, then hands off
 * to wherever they were headed.
 *
 * Links we mint ourselves and post through Resend land at /auth/confirm
 * instead — they carry a token hash rather than a PKCE code.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const requested = searchParams.get('next');

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=callback`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=callback`);
  }

  const viewer = await getViewer();

  // Without a viewer there is nothing to route by; send them somewhere safe
  // rather than guessing.
  if (!viewer) return NextResponse.redirect(`${origin}${safeRedirectPath(requested, '/')}`);

  // Signing in through Google is signing in like any other: one account type
  // goes straight to its home, more than one is asked which.
  const next = await afterSignIn(viewer, requested);

  // Google supplies a name and never a phone number, and an operator cannot
  // approve a passenger they have no way to reach. The password signup form
  // now asks for both up front, so this detour is only for OAuth.
  if (!profileIsComplete(viewer.profile)) {
    return NextResponse.redirect(`${origin}/profile?next=${encodeURIComponent(next)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
