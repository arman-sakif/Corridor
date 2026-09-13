'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireOperatorRole, requireViewer } from '@/lib/auth/session';
import { rememberMode } from '@/lib/auth/mode-session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { findAcrossPages } from '@/lib/operator/paging';
import {
  inviteRevokeSchema,
  memberInviteSchema,
  memberRemoveSchema,
  operatorApplicationSchema,
  operatorProfileSchema,
} from '@/lib/validation/operator';

/**
 * Applying creates a `pending` operator, invisible to passengers. A trigger
 * attaches the applicant as owner, because the membership policy needs an
 * owner to exist before one can be inserted.
 */
export async function applyAsOperator(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireViewer('/for-operators');
  const parsed = parseForm(operatorApplicationSchema, formData);
  if (!parsed.ok) return parsed.state;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('operators')
    .insert({
      name: parsed.data.name,
      type: parsed.data.type,
      public_phone: parsed.data.public_phone,
      bio: parsed.data.bio || null,
      status: 'pending',
      created_by: viewer.userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    return fail('We could not submit that application. Try again in a moment.');
  }

  // They applied as a business. An operator account starts without passenger
  // unless the person has already booked as one — then it stays, so no ride
  // they hold goes out of sight. Either way Profile can switch it back.
  const { count: booked } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('passenger_id', viewer.userId);
  if (!booked) await supabase.rpc('set_account_mode', { p_mode: 'passenger', p_enabled: false });
  await rememberMode('operator');

  revalidatePath('/', 'layout');
  redirect(`/operator/${data.id}`);
}

export async function saveOperatorProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(operatorProfileSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireOperatorRole(parsed.data.operator_id, ['owner']);

  const supabase = await createClient();
  const { error } = await supabase
    .from('operators')
    .update({
      name: parsed.data.name,
      public_phone: parsed.data.public_phone,
      bio: parsed.data.bio || null,
    })
    .eq('id', parsed.data.operator_id);

  if (error) return fail('We could not save those details. Try again in a moment.');

  revalidatePath(`/operator/${parsed.data.operator_id}/settings`);
  return succeed('Saved.');
}

/**
 * Puts someone on the team, whether or not they have an account yet.
 *
 * If they are already registered they are added outright. If they are not,
 * the address is recorded as an invite and a database trigger attaches the
 * membership the moment they sign up — so the owner never has to come back and
 * finish the job, which is what this screen used to demand of them.
 *
 * Looking a user up by email needs the service-role client — a policy cannot
 * expose the whole profile table to anyone who wants to probe for addresses.
 * Both writes are then made as the caller, so RLS still governs the part that
 * matters.
 */
export async function addTeamMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(memberInviteSchema, formData);
  if (!parsed.ok) return parsed.state;

  const { viewer } = await requireOperatorRole(parsed.data.operator_id, ['owner']);

  const supabase = await createClient();
  const match = await findUserByEmail(parsed.data.email);

  if (match) {
    const { error } = await supabase.from('operator_members').insert({
      operator_id: parsed.data.operator_id,
      user_id: match.id,
      role: parsed.data.role,
    });

    if (error) {
      return fail(
        error.code === '23505'
          ? 'They are already on your team.'
          : 'We could not add them. Try again in a moment.',
      );
    }

    revalidatePath(`/operator/${parsed.data.operator_id}/team`);
    return succeed(`${parsed.data.email} can now sign in to this business.`);
  }

  const { error } = await supabase.from('operator_invites').insert({
    operator_id: parsed.data.operator_id,
    email: parsed.data.email,
    role: parsed.data.role,
    invited_by: viewer.userId,
  });

  if (error) {
    return fail(
      error.code === '23505'
        ? 'You have already invited that address.'
        : 'We could not save that invitation. Try again in a moment.',
    );
  }

  revalidatePath(`/operator/${parsed.data.operator_id}/team`);
  return succeed(
    `Invited ${parsed.data.email}. They join the team as soon as they create an account with that address.`,
  );
}

/** Withdraws an invitation that has not been taken up. */
export async function revokeInvite(formData: FormData): Promise<void> {
  const parsed = parseForm(inviteRevokeSchema, formData);
  if (!parsed.ok) return;

  await requireOperatorRole(parsed.data.operator_id, ['owner']);

  const supabase = await createClient();
  await supabase
    .from('operator_invites')
    .delete()
    .eq('id', parsed.data.invite_id)
    .is('accepted_at', null);

  revalidatePath(`/operator/${parsed.data.operator_id}/team`);
}

/**
 * Finds an auth user by email address, across the whole user table.
 *
 * `listUsers()` is paginated and defaults to the first 50. Called bare, it
 * stops seeing people the moment the platform has more accounts than that —
 * and the failure is silent and actively misleading: the owner is told
 * "nobody signs in with that email yet" about a colleague who plainly does,
 * and the only apparent fix is to sign up again with an address that is
 * already taken.
 *
 * GoTrue offers no lookup-by-email, and `auth.users` is not exposed to
 * PostgREST, so paging is the way. The cap is there so a bad response cannot
 * spin this forever; a real team member is found on page one either way.
 */
async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const admin = createAdminClient();

  // The walking is in `paging.ts` and unit-tested there. This function is only
  // the part that needs a live GoTrue, which is the part that was never wrong.
  return findAcrossPages(
    async (page, perPage) => {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      return error || !data ? null : data.users;
    },
    (user) => user.email?.toLowerCase() === email,
  );
}

export async function removeTeamMember(formData: FormData): Promise<void> {
  const parsed = parseForm(memberRemoveSchema, formData);
  if (!parsed.ok) return;

  const { viewer } = await requireOperatorRole(parsed.data.operator_id, ['owner']);

  const supabase = await createClient();

  // An operator with no owner is unmanageable and cannot be repaired from the
  // UI, so refuse to remove the last one.
  const { data: owners } = await supabase
    .from('operator_members')
    .select('id, user_id, role')
    .eq('operator_id', parsed.data.operator_id)
    .eq('role', 'owner');

  const target = (owners ?? []).find((m) => m.id === parsed.data.member_id);
  if (target && (owners ?? []).length <= 1) return;
  if (target?.user_id === viewer.userId && (owners ?? []).length <= 1) return;

  await supabase
    .from('operator_members')
    .delete()
    .eq('id', parsed.data.member_id)
    .eq('operator_id', parsed.data.operator_id);

  revalidatePath(`/operator/${parsed.data.operator_id}/team`);
}
