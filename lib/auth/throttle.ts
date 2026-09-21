import 'server-only';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

import {
  lockoutMessage,
  MAX_PER_EMAIL,
  MAX_PER_IP,
  retryAfterMinutes,
  WINDOW_MS,
} from '@/lib/auth/lockout';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Counting failed sign-ins, by account and by caller.
 *
 * GoTrue already refuses too many attempts from one IP, and two things make
 * that insufficient — neither of them Supabase's fault.
 *
 * **It counts the wrong caller.** Sign-in runs in a Server Action, so the
 * request GoTrue sees comes from the Vercel function rather than from the
 * person typing. Every sign-in on the site shares one bucket, which is worse
 * than no limit in one specific way: anyone who wants the site down only has
 * to spend the shared allowance, and everybody else is locked out of their own
 * account. The limit becomes the attack.
 *
 * **It counts per IP and never per account.** Spraying one common password
 * across many accounts from rotating addresses is the attack that actually
 * works against a site this size, and nothing was counting it.
 *
 * So both are counted here, where the real caller is visible. This is the same
 * shape as the recovery throttle in `./recovery.ts`; the difference is that
 * one guards sending email and this one guards guessing.
 *
 * Subjects are SHA-256 hashes, never the address or the IP in the clear. In
 * the clear this table would be a roster of which addresses have been tried
 * and a log of who was where — two things worth not keeping.
 */

export type ThrottleVerdict = { allowed: true } | { allowed: false; message: string };

const ALLOWED: ThrottleVerdict = { allowed: true };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The address the request actually came from.
 *
 * `x-forwarded-for` is a list, and the leftmost entry is the client as the
 * first proxy saw it. On Vercel that header is set by the platform, so it is
 * not something a caller can simply claim. Anywhere it is absent the IP
 * counter is skipped rather than guessed — a made-up key would pool every
 * caller into one bucket, which is the failure this whole module exists to
 * undo.
 */
async function callerIp(): Promise<string | null> {
  const header = await headers();
  const forwarded = header.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || header.get('x-real-ip') || null;
}

/**
 * Whether this sign-in may be attempted at all.
 *
 * Fails **open**: if the counter itself is broken, the attempt goes through. A
 * rate limit that fails closed locks everyone out of their own accounts over a
 * database hiccup, which is the larger harm of the two — the same call the
 * recovery throttle makes.
 */
export async function signInAllowed(email: string): Promise<ThrottleVerdict> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  // Housekeeping on the way past, so the table stays the size of a quarter of
  // an hour of traffic rather than growing forever.
  await admin.from('auth_sign_in_attempts').delete().lt('attempted_at', since);

  const ip = await callerIp();
  const subjects: { kind: 'email' | 'ip'; hash: string; max: number }[] = [
    { kind: 'email', hash: hash(email), max: MAX_PER_EMAIL },
  ];
  if (ip) subjects.push({ kind: 'ip', hash: hash(ip), max: MAX_PER_IP });

  for (const subject of subjects) {
    const { data, error } = await admin
      .from('auth_sign_in_attempts')
      .select('attempted_at')
      .eq('kind', subject.kind)
      .eq('subject_hash', subject.hash)
      .gte('attempted_at', since)
      .order('attempted_at', { ascending: true });

    if (error) {
      console.error('sign-in throttle check failed', error);
      return ALLOWED;
    }

    if ((data?.length ?? 0) >= subject.max) {
      console.info('[sign-in] refused: rate limited', {
        kind: subject.kind,
        ref: subject.hash.slice(0, 12),
      });
      return {
        allowed: false,
        message: lockoutMessage(retryAfterMinutes(data?.[0]?.attempted_at ?? null)),
      };
    }
  }

  return ALLOWED;
}

/**
 * Records one failure, against the account and against the caller.
 *
 * Counted for addresses with no account at all, which is what makes the
 * lockout sentence safe to show: it is the same either way, so it answers
 * nothing that sign-in itself refuses to confirm.
 */
export async function recordFailedSignIn(email: string): Promise<void> {
  const admin = createAdminClient();
  const ip = await callerIp();

  const rows: { kind: 'email' | 'ip'; subject_hash: string }[] = [
    { kind: 'email', subject_hash: hash(email) },
  ];
  if (ip) rows.push({ kind: 'ip', subject_hash: hash(ip) });

  const { error } = await admin.from('auth_sign_in_attempts').insert(rows);
  if (error) console.error('sign-in throttle record failed', error);
}

/**
 * Forgets an account's failures once somebody gets in. Two fumbled passwords
 * and then the right one is not two strikes carried into tomorrow.
 *
 * The caller's IP count is deliberately left alone: a successful sign-in from
 * an address that has just failed thirty times is exactly what a working
 * credential-stuffing run looks like.
 */
export async function clearFailedSignIns(email: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('auth_sign_in_attempts')
    .delete()
    .eq('kind', 'email')
    .eq('subject_hash', hash(email));

  if (error) console.error('sign-in throttle clear failed', error);
}
