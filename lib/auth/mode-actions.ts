'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { activeMode, chooserPath, forgetMode, rememberMode } from '@/lib/auth/mode-session';
import { availableModes, destinationFor, isAccountMode } from '@/lib/auth/modes';
import { safeRedirectPath } from '@/lib/auth/routing';
import { requireViewer } from '@/lib/auth/session';
import { dynamicRoute } from '@/lib/routes';
import { createClient } from '@/lib/supabase/server';

/** "Log in as": the picker at sign-in, and Switch in the header. */
export async function chooseAccountMode(formData: FormData): Promise<void> {
  const viewer = await requireViewer('/choose-account');
  const mode = formData.get('mode');
  const next = safeRedirectPath(formData.get('next')?.toString(), '/');

  // A type they do not have, from a stale page or a hand-built form.
  if (!isAccountMode(mode) || !availableModes(viewer).includes(mode)) {
    redirect(dynamicRoute(chooserPath(next)));
  }

  await rememberMode(mode);
  // The whole app changes colour and navigation, from the root layout down.
  revalidatePath('/', 'layout');
  redirect(dynamicRoute(destinationFor(viewer, mode, next)));
}

/**
 * Switches an account type on or off in Profile. The hierarchy is enforced by
 * `set_account_mode()`; this only offers what it would allow, and reports back
 * through the URL so the page can say what happened.
 */
export async function setAccountType(formData: FormData): Promise<void> {
  const viewer = await requireViewer('/profile');
  const mode = formData.get('mode');
  const enabled = formData.get('enabled') === 'on';

  if (mode !== 'passenger' && mode !== 'driver') redirect('/profile');

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_account_mode', { p_mode: mode, p_enabled: enabled });
  if (error) redirect(dynamicRoute('/profile?types=refused'));

  // Switching off the type you are in leaves you nowhere to stand. Forget it,
  // and the next page either picks your only remaining type or asks.
  if (!enabled && (await activeMode(viewer)) === mode) await forgetMode();

  revalidatePath('/', 'layout');
  redirect(dynamicRoute(`/profile?types=${enabled ? 'on' : 'off'}-${mode}`));
}
