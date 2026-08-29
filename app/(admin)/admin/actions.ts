'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import {
  cityCreateSchema,
  cityToggleSchema,
  operatorStatusSchema,
  subscriptionSchema,
} from '@/lib/validation/admin';

/**
 * Every action here re-checks admin rights before touching anything. RLS says
 * the same thing, and the status trigger says it a third time — vetting is the
 * one decision an operator must never be able to make for itself.
 */

export async function createCity(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = parseForm(cityCreateSchema, formData);
  if (!parsed.ok) return parsed.state;

  const supabase = await createClient();
  const { error } = await supabase.from('cities').insert({
    name: parsed.data.name,
    province: parsed.data.province,
  });

  if (error) {
    return fail(
      error.code === '23505'
        ? `${parsed.data.name} is already on the list.`
        : 'We could not add that city. Try again in a moment.',
    );
  }

  revalidatePath('/admin/cities');
  return succeed(`${parsed.data.name} is now searchable.`);
}

export async function setCityActive(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = parseForm(cityToggleSchema, formData);
  if (!parsed.ok) return;

  const supabase = await createClient();
  await supabase
    .from('cities')
    .update({ is_active: parsed.data.is_active })
    .eq('id', parsed.data.city_id);

  revalidatePath('/admin/cities');
}

export async function setOperatorStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = parseForm(operatorStatusSchema, formData);
  if (!parsed.ok) return;

  const supabase = await createClient();
  await supabase
    .from('operators')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.operator_id);

  revalidatePath('/admin');
  revalidatePath(`/admin/operators/${parsed.data.operator_id}`);
}

export async function saveSubscription(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireAdmin();
  const parsed = parseForm(subscriptionSchema, formData);
  if (!parsed.ok) return parsed.state;

  const supabase = await createClient();

  // Payment is collected off-platform, so this table only records what the
  // admin has already seen land in the bank.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('operator_id', parsed.data.operator_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const values = {
    operator_id: parsed.data.operator_id,
    plan: parsed.data.plan,
    status: parsed.data.status,
    current_period_end: parsed.data.current_period_end || null,
  };

  const { error } = existing
    ? await supabase.from('subscriptions').update(values).eq('id', existing.id)
    : await supabase.from('subscriptions').insert(values);

  if (error) return fail('We could not record that subscription. Try again in a moment.');

  revalidatePath('/admin/subscriptions');
  return succeed('Subscription recorded.');
}
