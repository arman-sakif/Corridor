import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { enforceUniqueContact } from '@/lib/supabase/env';

/**
 * One contact detail, one account.
 *
 * Email is already settled by Supabase: `auth.users.email` is unique, so an
 * address can only ever be one account. Note that this is one account, not one
 * account *per role* — and that is right. A person who drives for one operator
 * and rides home with another is one person, and both `landingPathFor` and the
 * site header are built around exactly that overlap. Making them hold two
 * logins would be a worse product, not a safer one.
 *
 * Phone is the gap. `profiles.phone` is bare nullable text with no constraint,
 * so nothing today stops ten accounts sharing a number — which matters,
 * because that number is what an operator dials to reach a passenger, and a
 * number that reaches the wrong person is worse than no number at all.
 *
 * The rule is off by default. See `enforceUniqueContact()` for why, and
 * `20260830000017_phone_uniqueness_check.sql` for the index that will make it
 * true at the database level once it is switched on for good.
 */

export type ContactCheck = { ok: true } | { ok: false; field: 'phone'; message: string };

const AVAILABLE: ContactCheck = { ok: true };

export async function checkContactAvailable(input: {
  phone?: string | null;
  /** The account doing the saving, so editing your own profile is not a clash. */
  excludeUserId?: string;
}): Promise<ContactCheck> {
  if (!enforceUniqueContact()) return AVAILABLE;
  if (!input.phone) return AVAILABLE;

  // Service role, and a function that returns a boolean and nothing else: a
  // passenger cannot read another passenger's profile, and asking "is this
  // number taken" must not become a way around that.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('phone_in_use', {
    p_phone: input.phone,
    p_exclude: input.excludeUserId ?? null,
  });

  // A failed lookup must not block a signup. Losing the check on one request
  // is a smaller harm than turning a database hiccup into a locked door.
  if (error) {
    console.error('phone_in_use failed', error);
    return AVAILABLE;
  }

  if (!data) return AVAILABLE;

  return {
    ok: false,
    field: 'phone',
    message: 'That phone number is already on another account. Sign in to that one instead.',
  };
}
