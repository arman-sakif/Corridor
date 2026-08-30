'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';
import { dynamicRoute } from '@/lib/routes';
import { todayInToronto } from '@/lib/time';
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
    amount_cents: parsed.data.amount ?? 0,
    current_period_end: parsed.data.current_period_end || null,
  };

  const { error } = existing
    ? await supabase.from('subscriptions').update(values).eq('id', existing.id)
    : await supabase.from('subscriptions').insert(values);

  if (error) return fail('We could not record that subscription. Try again in a moment.');

  // A payment is a fact that happened on a day, not a field to overwrite. The
  // subscription row says what they owe now; the ledger says what has landed,
  // and saving the row again must not quietly rewrite that history.
  if (parsed.data.record_payment && values.amount_cents > 0) {
    const viewer = await requireAdmin();

    const { error: ledgerError } = await supabase.from('subscription_payments').insert({
      operator_id: parsed.data.operator_id,
      amount_cents: values.amount_cents,
      paid_on: todayInToronto(),
      covers_until: values.current_period_end,
      recorded_by: viewer.userId,
    });

    if (ledgerError) {
      return fail('The plan was saved, but the payment did not record. Try recording it again.');
    }
  }

  revalidatePath('/admin/subscriptions');
  revalidatePath(dynamicRoute(`/operator/${parsed.data.operator_id}/billing`));
  return succeed(parsed.data.record_payment ? 'Payment recorded.' : 'Subscription saved.');
}
