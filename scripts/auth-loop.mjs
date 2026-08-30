/**
 * The whole account loop, end to end, against the real database.
 *
 *   node scripts/auth-loop.mjs
 *
 * Signup, both recovery paths, the throttle, and the privilege boundaries
 * around them. The pieces are unit-tested and the SQL replays under PGlite,
 * but the *sequence* is what breaks: a signup whose metadata never reaches the
 * trigger, an OTP minted as one type and verified as another, a rate-limit
 * table the service role turns out not to be able to write.
 *
 * Every credential here is minted the same way `lib/auth/recovery.ts` mints
 * it, so a change that breaks the app breaks this too.
 *
 * It creates its own accounts and deletes them again, including on failure.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A fresh browser: no session, nothing remembered between steps. */
const anon = () =>
  createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const stamp = Date.now();
const EMAIL = `auth-loop-${stamp}@corridor.test`;
const PHONE = '(519) 555-0134';
const FULL_NAME = 'Auth Loop';
const PASSWORD = 'auth-loop-password-123';
const NEW_PASSWORD = 'auth-loop-changed-456';

let failures = 0;
let step = 0;
const check = (pass, name, detail = '') => {
  step += 1;
  if (!pass) failures += 1;
  console.log(
    `${pass ? ' ok ' : 'FAIL'}  ${String(step).padStart(2)}. ${name}${detail ? ` — ${detail}` : ''}`,
  );
};

const createdUsers = [];

async function cleanup() {
  for (const id of createdUsers) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  await admin.from('auth_recovery_requests').delete().neq('email_hash', '');
}

async function main() {
  /* ----------------------------------------------- what the project is set to */

  // The two settings that decide whether the signup screen is one step or two,
  // and whether the Google button does anything. Neither lives in this repo,
  // so read them rather than assume them.
  const settings = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: PUBLISHABLE },
  }).then((r) => r.json());

  check(
    settings.mailer_autoconfirm === true,
    'email confirmation is off, so signup is one step',
    settings.mailer_autoconfirm ? '' : 'ON — Authentication → Providers → Email → Confirm email',
  );
  check(
    settings.external?.google === true,
    'the Google provider is configured',
    settings.external?.google ? '' : 'not enabled — see README, "Google sign-in"',
  );

  /* ------------------------------------------------- signup carries through */

  // The real public path, with exactly the payload lib/auth/actions.ts sends —
  // not admin.createUser, which would bypass the two things most worth
  // proving: that an anonymous visitor can do this at all, and that they walk
  // away holding a session.
  const { data: created, error: signUpError } = await anon().auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { data: { full_name: FULL_NAME, phone: PHONE } },
  });

  check(!signUpError && Boolean(created.user), 'signup creates an account', signUpError?.message);
  if (created.user) createdUsers.push(created.user.id);
  if (!created.user) return;

  // The friction check. No session here means email confirmation is back on in
  // the hosted project, which puts a click-this-link step between a passenger
  // and their first booking and caps signups at Supabase's shared-SMTP rate.
  // Fix it at Authentication → Providers → Email → Confirm email, not here.
  check(
    Boolean(created.session),
    'and signs them in on the spot, with no email to confirm',
    created.session ? '' : 'email confirmation is ON — turn it off in the dashboard',
  );

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, phone')
    .eq('id', created.user.id)
    .single();

  check(profile?.full_name === FULL_NAME, 'the trigger stored the name from signup', profile?.full_name);
  check(profile?.phone === PHONE, 'the trigger stored the phone from signup', profile?.phone);

  // profileIsComplete() is what decides whether /auth/callback detours through
  // /profile. Both fields present means a password signup goes straight on.
  check(
    Boolean(profile?.full_name?.trim() && profile?.phone?.trim()),
    'the profile is complete, so signup skips the /profile detour',
  );

  const { data: firstSignIn, error: firstSignInError } = await anon().auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  check(!firstSignInError && Boolean(firstSignIn?.session), 'the password works', firstSignInError?.message);

  /* --------------------------------------------------- the sign-in-code path */

  const { data: magic, error: magicError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: EMAIL,
  });

  check(!magicError && Boolean(magic?.properties?.email_otp), 'a sign-in code is minted', magicError?.message);
  // Length is a project setting (`otp_length`), not a constant — this project
  // issues eight where the CLI default is six. loginCodeSchema accepts the
  // range for exactly that reason.
  check(
    /^\d{6,10}$/.test(magic?.properties?.email_otp ?? ''),
    'the code is digits only',
    magic?.properties?.email_otp,
  );

  const codeClient = anon();
  const { data: viaCode, error: codeError } = await codeClient.auth.verifyOtp({
    email: EMAIL,
    token: magic.properties.email_otp,
    type: 'recovery',
  });

  check(!codeError && Boolean(viaCode?.session), 'the code signs you in', codeError?.message);
  check(viaCode?.user?.id === created.user.id, 'and signs in the right account');

  const { error: replayError } = await anon().auth.verifyOtp({
    email: EMAIL,
    token: magic.properties.email_otp,
    type: 'recovery',
  });
  check(Boolean(replayError), 'the same code cannot be used twice');

  const { error: wrongCode } = await anon().auth.verifyOtp({
    email: EMAIL,
    token: '000000',
    type: 'recovery',
  });
  check(Boolean(wrongCode), 'a made-up code is refused');

  /* ------------------------------------------------------- the reset-link path */

  const { data: recovery, error: recoveryError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: EMAIL,
  });

  check(
    !recoveryError && Boolean(recovery?.properties?.hashed_token),
    'a reset link is minted',
    recoveryError?.message,
  );

  // Exactly what /auth/confirm does with the token_hash off the query string.
  const linkClient = anon();
  const { data: viaLink, error: linkError } = await linkClient.auth.verifyOtp({
    token_hash: recovery.properties.hashed_token,
    type: 'recovery',
  });

  check(!linkError && Boolean(viaLink?.session), 'the reset link redeems into a session', linkError?.message);

  const { error: updateError } = await linkClient.auth.updateUser({ password: NEW_PASSWORD });
  check(!updateError, 'that session can set a new password', updateError?.message);

  const { data: newSignIn, error: newSignInError } = await anon().auth.signInWithPassword({
    email: EMAIL,
    password: NEW_PASSWORD,
  });
  check(!newSignInError && Boolean(newSignIn?.session), 'the new password works', newSignInError?.message);

  const { error: oldStillWorks } = await anon().auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  check(Boolean(oldStillWorks), 'the old password no longer works');

  /* --------------------------------------------------- no enumeration oracle */

  const unknownMagic = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: `nobody-${stamp}@corridor.test`,
  });

  // requestRecovery swallows exactly this and returns the same sentence as a
  // real send. The point of the check is that it errors rather than quietly
  // CREATING the account — which is what type 'magiclink' does here, and is
  // why both paths mint a 'recovery' link.
  check(Boolean(unknownMagic.error), 'an address with no account is refused, not created');
  check(!unknownMagic.data?.user, 'and no account is conjured for it', unknownMagic.data?.user?.email);

  /* ------------------------------------------------------------- the throttle */

  const hash = 'a'.repeat(64);
  const { error: insertError } = await admin
    .from('auth_recovery_requests')
    .insert([{ email_hash: hash }, { email_hash: hash }, { email_hash: hash }]);
  check(!insertError, 'the service role can record a recovery request', insertError?.message);

  const { count } = await admin
    .from('auth_recovery_requests')
    .select('*', { count: 'exact', head: true })
    .eq('email_hash', hash)
    .gte('requested_at', new Date(Date.now() - 3600_000).toISOString());
  check(count === 3, 'and count them within the hour', `count=${count}`);

  const { error: anonRead } = await anon().from('auth_recovery_requests').select('*').limit(1);
  check(Boolean(anonRead), 'a signed-out visitor cannot read the throttle table');

  const authed = anon();
  await authed.auth.signInWithPassword({ email: EMAIL, password: NEW_PASSWORD });
  const { error: authedRead } = await authed.from('auth_recovery_requests').select('*').limit(1);
  check(Boolean(authedRead), 'nor can a signed-in one');

  /* ------------------------------------------------------- phone uniqueness */

  const { data: inUse, error: inUseError } = await admin.rpc('phone_in_use', { p_phone: PHONE });
  check(!inUseError && inUse === true, 'phone_in_use finds the number we just registered', inUseError?.message);

  const { data: punctuated } = await admin.rpc('phone_in_use', { p_phone: '+1 519-555-0134' });
  check(punctuated === true, 'and matches it through different punctuation');

  const { data: excluded } = await admin.rpc('phone_in_use', {
    p_phone: PHONE,
    p_exclude: created.user.id,
  });
  check(excluded === false, 'editing your own profile is not a clash with yourself');

  const { data: free } = await admin.rpc('phone_in_use', { p_phone: '(226) 555-9999' });
  check(free === false, 'an unused number is free');

  const { error: anonRpc } = await anon().rpc('phone_in_use', { p_phone: PHONE });
  check(Boolean(anonRpc), 'and a stranger cannot ask whether a number has an account');
}

main()
  .catch((error) => {
    failures += 1;
    console.error('\nthrew:', error);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n${step - failures}/${step} checks passed`);
    process.exit(failures === 0 ? 0 : 1);
  });
