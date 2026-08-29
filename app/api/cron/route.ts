import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Housekeeping, once a day.
 *
 * Two jobs, and it matters that neither is load-bearing:
 *
 *   - `generate_departures` rolls the 30-day window forward. It is idempotent,
 *     so running it twice, or late, or after an operator has already sold
 *     seats, changes nothing it should not.
 *
 *   - `expire_stale_holds` relabels lapsed holds so a passenger's list reads
 *     honestly. **Capacity does not depend on it.** Every capacity query
 *     excludes expired holds inline, so if this never runs again, seats still
 *     free themselves the instant their hold lapses. The only consequence is
 *     that a dead hold keeps saying "waiting on the operator".
 *
 * If the free tier makes scheduling awkward, the fallback is to generate
 * lazily on the first search for a date. Nothing here is a prerequisite for
 * the booking path being correct.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // Vercel Cron sends the secret as a bearer token. Without one configured the
  // route stays shut rather than running on anyone's request.
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = createAdminClient();

  const [generated, expired] = await Promise.all([
    supabase.rpc('generate_departures', { p_operator_id: null, p_days: 30 }),
    supabase.rpc('expire_stale_holds'),
  ]);

  if (generated.error || expired.error) {
    console.error('cron failed', generated.error ?? expired.error);
    return NextResponse.json(
      { ok: false, error: (generated.error ?? expired.error)?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    departuresCreated: generated.data ?? 0,
    holdsExpired: expired.data ?? 0,
  });
}
