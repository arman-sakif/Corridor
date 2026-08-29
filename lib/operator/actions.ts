'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { requireOperatorRole, requireViewer } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
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

  revalidatePath('/for-operators');
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
 * Adds someone who already has a Corridor account to the team.
 *
 * Looking a user up by email needs the service-role client — a policy cannot
 * expose the whole profile table to anyone who wants to probe for addresses.
 * The membership itself is then written as the caller, so RLS still applies to
 * the part that matters.
 */
export async function addTeamMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(memberInviteSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireOperatorRole(parsed.data.operator_id, ['owner']);

  const admin = createAdminClient();
  const { data: found } = await admin.auth.admin.listUsers();
  const match = found?.users.find(
    (user) => user.email?.toLowerCase() === parsed.data.email,
  );

  if (!match) {
    return fail(
      `Nobody signs in with ${parsed.data.email} yet. Ask them to create an account first, then add them.`,
    );
  }

  const supabase = await createClient();
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
