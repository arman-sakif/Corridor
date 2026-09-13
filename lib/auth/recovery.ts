'use server';

import { createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { afterSignIn, homePath } from '@/lib/auth/mode-session';
import { safeRedirectPath } from '@/lib/auth/routing';
import { getViewer, requireViewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { notify } from '@/lib/notify';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { loginCodeSchema, recoveryRequestSchema, updatePasswordSchema } from '@/lib/validation/auth';

/**
 * Getting back into an account, two ways.
 *
 * A code signs you straight in, then offers to set a new password. A link
 * takes you directly to that page. Both start the same way — `generateLink`
 * mints one credential that carries both a code and a hashed token — and both
 * are delivered through notify(), so the email comes from our domain in our
 * wording rather than from Supabase's default sender.
 *
 * One credential means one live email. GoTrue keeps a single recovery token
 * per account, so every request cancels whatever the previous email carried:
 * ask for a link and then a code, and the link is dead. The form and both
 * emails say so, because a reader who tries "both, to be safe" otherwise opens
 * the first email and gets told it has expired.
 *
 * The thing to keep hold of while editing this file: none of it may reveal
 * whether an address has an account. `signInWithPassword` is deliberately
 * vague about which half of the pair was wrong; a recovery form that answers
 * "no such account" hands over for free what sign-in refuses to confirm.
 */

/** Said whatever happened, so the answer itself carries no information. */
const SENT =
  'If that address has an account, the email is on its way. It can take a minute — check your spam folder too.';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;

export async function requestRecovery(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(recoveryRequestSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { email, method } = parsed.data;
  const ref = emailRef(email);

  // Counted before the account is looked up, and counted for addresses that
  // have no account at all. That is what makes it safe to say out loud that
  // someone has hit the limit: the answer is the same either way.
  if (!(await underRateLimit(email))) {
    console.info('[recovery] refused: rate limited', { ref, method });
    return fail(
      'That is three requests for this address within the hour. Wait a little, or look again for the last email — it may already be in your spam folder.',
    );
  }

  const admin = createAdminClient();

  // 'recovery' for both, and this is not an arbitrary choice.
  // `generateLink({ type: 'magiclink' })` *creates the account* when the
  // address has none — which on a public, unauthenticated form means anyone
  // could conjure accounts for addresses they do not own and have us mail
  // them a working sign-in code. 'recovery' refuses an address it does not
  // already know, which is the behaviour a recovery form needs.
  //
  // One call still yields both credentials: `email_otp` for the code, and
  // `hashed_token` for the link. Verification later has to name this same
  // type — see verifyLoginCode and /auth/confirm.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  });

  // Almost always "that user does not exist". Nothing to do, and nothing to
  // say — the caller gets the same sentence as a real send.
  //
  // The log is what the reader of the screen cannot have: which of the two
  // happened. It names the request by `ref`, never by address, and the reason
  // by GoTrue's code rather than its message, which can quote the address.
  if (error || !data.properties) {
    console.info('[recovery] no email sent: account not found or link refused', {
      ref,
      method,
      reason: error ? (error.code ?? error.status) : 'no link properties',
    });
    return succeed(SENT);
  }

  // Whether Resend then accepts it is notify()'s line to log, straight after.
  console.info('[recovery] account found, sending', { ref, method });

  if (method === 'code') {
    await notify({
      kind: 'login_code',
      to: [email],
      subject: `${data.properties.email_otp} is your Corridor sign-in code`,
      body: [
        `Your sign-in code is ${data.properties.email_otp}.`,
        '',
        'Enter it on the Corridor screen you left open. It expires in an hour,',
        'or as soon as you ask for another code or a reset link.',
        '',
        'If you did not ask for this you can ignore this email — nobody can get',
        'into your account without the code.',
      ].join('\n'),
    });
  } else {
    // Our own /auth/confirm route rather than the action_link Supabase hands
    // back: that one points at Supabase's verify endpoint and carries no PKCE
    // code, so it would fail in /auth/callback where the OAuth flow ends.
    const link =
      `/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
      `&type=recovery&next=${encodeURIComponent('/update-password')}`;

    await notify({
      kind: 'password_reset',
      to: [email],
      subject: 'Reset your Corridor password',
      body: [
        'Open the link below to choose a new password. It expires in an hour,',
        'or as soon as you ask for another link or a sign-in code.',
        '',
        'If you did not ask for this you can ignore this email. Your password',
        'stays as it is until someone opens the link.',
      ].join('\n'),
      link,
    });
  }

  return succeed(SENT);
}

export async function verifyLoginCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(loginCodeSchema, formData);
  if (!parsed.ok) return parsed.state;

  // The request-scoped client, not the admin one: this is what writes the
  // session cookie that keeps them signed in afterwards.
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    // Matches the type requestRecovery minted it as. A code generated as one
    // type and verified as another fails with a message that reads like an
    // expired code.
    type: 'recovery',
  });

  if (error) {
    return fail(
      'That code did not work. It may have expired, or have a digit out of place — ask for a new one and try again.',
    );
  }

  // Signing in by code is still signing in: someone with more than one account
  // type is asked which, once their new password is set or skipped.
  const viewer = await getViewer();
  const destination = viewer
    ? await afterSignIn(viewer, parsed.data.next)
    : safeRedirectPath(parsed.data.next, '/');

  // Signed in, but still without a password they know — which is why they
  // came. Stopping here left them inside and none the wiser, so offer to set
  // one; the page carries a "skip" through to where they were going.
  redirect(
    dynamicRoute(`/update-password?via=code&next=${encodeURIComponent(destination)}`),
  );
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(updatePasswordSchema, formData);
  if (!parsed.ok) return parsed.state;

  // Holding a session is the authorisation here: you reach this page either by
  // opening a link sent to the address on the account, or by already being
  // signed in.
  const viewer = await requireViewer('/update-password');

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return fail(
      error.code === 'same_password'
        ? 'That is the password you already have. Choose a different one.'
        : 'We could not change your password. Try again in a moment.',
    );
  }

  revalidatePath('/', 'layout');
  const next =
    parsed.data.next && parsed.data.next !== '/'
      ? safeRedirectPath(parsed.data.next, '/')
      : await homePath(viewer);
  redirect(dynamicRoute(next));
}

/**
 * Three sends per address per hour.
 *
 * `generateLink` is an admin call, so it goes around GoTrue's own per-address
 * email limit. Without this, an anonymous form on the public internet would
 * send as many emails as anyone asked for, to any address they named.
 *
 * The address is hashed, never stored: a table of real addresses would be a
 * roster of who has an account, which is the one thing this whole file is
 * arranged not to disclose.
 */
async function underRateLimit(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const emailHash = hashEmail(email);
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  // Housekeeping on the way past, so the table stays the size of an hour of
  // traffic rather than growing forever.
  await admin.from('auth_recovery_requests').delete().lt('requested_at', since);

  const { count, error } = await admin
    .from('auth_recovery_requests')
    .select('*', { count: 'exact', head: true })
    .eq('email_hash', emailHash)
    .gte('requested_at', since);

  // If the counter itself is broken, let the send through. A rate limit that
  // fails closed locks people out of their own accounts over a database
  // hiccup, which is the larger harm of the two.
  if (error) {
    console.error('recovery rate limit check failed', error);
    return true;
  }

  if ((count ?? 0) >= MAX_PER_WINDOW) return false;

  await admin.from('auth_recovery_requests').insert({ email_hash: emailHash });
  return true;
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

/**
 * A handle for one address in the logs, so a rate limit, a lookup and a send
 * can be tied together without writing the address down. A short prefix of the
 * hash the rate limit already stores — it discloses nothing that table does
 * not, and it matches that table's rows if they ever need comparing.
 */
function emailRef(email: string): string {
  return hashEmail(email).slice(0, 12);
}
