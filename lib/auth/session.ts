import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { OperatorMemberRole, Tables } from '@/lib/supabase/database.types';

export type Membership = {
  operator_id: string;
  role: OperatorMemberRole;
  operator: { id: string; name: string; status: Tables<'operators'>['status'] } | null;
};

export type Viewer = {
  userId: string;
  email: string | null;
  profile: Tables<'profiles'> | null;
  memberships: Membership[];
  isAdmin: boolean;
};

/**
 * The signed-in user, their profile, and their operator memberships.
 *
 * `cache` dedupes this across a single render, so a layout and three nested
 * Server Components asking who the viewer is costs one round trip, not four.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('operator_members')
      .select('operator_id, role, operator:operators(id, name, status)')
      .eq('user_id', user.id),
  ]);

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: profile ?? null,
    memberships: (memberships ?? []) as Membership[],
    isAdmin: profile?.platform_role === 'admin',
  };
});

export async function requireViewer(returnTo?: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/sign-in${next}`);
  }
  return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer('/admin');
  if (!viewer.isAdmin) redirect('/');
  return viewer;
}

/**
 * Asserts the caller belongs to this operator in one of `roles`, and returns
 * the membership.
 *
 * RLS enforces the same rule at the database. This is the second layer: a
 * missing policy should never be the only thing standing between one operator
 * and another operator's bookings.
 */
export async function requireOperatorRole(
  operatorId: string,
  roles: OperatorMemberRole[] = ['owner', 'staff'],
): Promise<{ viewer: Viewer; membership: Membership }> {
  const viewer = await requireViewer(`/operator/${operatorId}`);
  const membership = viewer.memberships.find(
    (m) => m.operator_id === operatorId && roles.includes(m.role),
  );
  if (!membership) redirect('/');
  return { viewer, membership };
}

/** True once the profile has the fields an operator needs at approval time. */
export function profileIsComplete(profile: Tables<'profiles'> | null): boolean {
  return Boolean(profile?.full_name?.trim() && profile?.phone?.trim());
}
