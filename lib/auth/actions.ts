'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { landingPathFor, safeRedirectPath } from '@/lib/auth/routing';
import { dynamicRoute, externalUrl } from '@/lib/routes';
import { getViewer } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { checkContactAvailable } from '@/lib/auth/contact-uniqueness';
import { createClient } from '@/lib/supabase/server';
import { siteUrl } from '@/lib/supabase/env';
import { profileSchema, signInSchema, signUpSchema } from '@/lib/validation/auth';

export async function signInWithPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(signInSchema, formData);
  if (!parsed.ok) return parsed.state;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately vague about which half was wrong: saying "no account with
    // that email" tells a stranger which addresses are registered.
    return fail('That email and password do not match an account.');
  }

  const viewer = await getViewer();
  const fallback = viewer ? landingPathFor(viewer) : '/';
  redirect(dynamicRoute(safeRedirectPath(parsed.data.next, fallback)));
}

export async function signUpWithPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(signUpSchema, formData);
  if (!parsed.ok) return parsed.state;

  const available = await checkContactAvailable({ phone: parsed.data.phone });
  if (!available.ok) return fail(available.message, { [available.field]: available.message });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback`,
      // Read by the on_auth_user_created trigger, which writes both onto the
      // profile. Passing them here rather than updating profiles afterwards is
      // what makes signup work when email confirmation is on and there is no
      // session yet to update under.
      data: { full_name: parsed.data.full_name, phone: parsed.data.phone },
    },
  });

  if (error) return fail(signUpErrorMessage(error));

  // With enumeration protection on, Supabase answers a signup for an address
  // that already exists with a success carrying no identities, rather than an
  // error. Same situation, different shape, same thing to tell the person.
  if (data.user && data.user.identities?.length === 0) {
    return fail('There is already an account with that email. Sign in instead.');
  }

  // With email confirmation on, there is no session yet: the user has to click
  // the link first.
  if (!data.session) {
    return succeed('Check your email for a link to confirm your address.');
  }

  // The form asked for everything an operator needs, so there is no profile
  // detour left to make — straight to wherever they were headed.
  const viewer = await getViewer();
  const fallback = viewer ? landingPathFor(viewer) : '/';
  redirect(dynamicRoute(safeRedirectPath(parsed.data.next, fallback)));
}

/**
 * Supabase reports a taken address in more than one way depending on how the
 * project is configured, and the wording is not a contract — the error code
 * is. The message check stays as a fallback for older gotrue builds.
 */
function signUpErrorMessage(error: { code?: string; message: string }): string {
  const taken =
    error.code === 'user_already_exists' ||
    error.code === 'email_exists' ||
    error.message.toLowerCase().includes('already');

  return taken
    ? 'There is already an account with that email. Sign in instead.'
    : 'We could not create that account. Try again in a moment.';
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeRedirectPath(formData.get('next')?.toString(), '/');
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error || !data.url) redirect('/sign-in?error=google');
  redirect(externalUrl(data.url));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function saveProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(profileSchema, formData);
  if (!parsed.ok) return parsed.state;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/profile');

  const available = await checkContactAvailable({
    phone: parsed.data.phone,
    excludeUserId: user.id,
  });
  if (!available.ok) return fail(available.message, { [available.field]: available.message });

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone,
      gender: parsed.data.gender || null,
      accommodation_notes: parsed.data.accommodation_notes || null,
    })
    .eq('id', user.id);

  if (error) return fail('We could not save your details. Try again in a moment.');

  revalidatePath('/profile');
  const next = formData.get('next')?.toString();
  if (next) redirect(dynamicRoute(safeRedirectPath(next, '/')));

  return succeed('Your details are saved.');
}
