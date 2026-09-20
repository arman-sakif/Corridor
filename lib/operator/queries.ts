import 'server-only';

import { summarize, type Insights } from '@/lib/operator/insights';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { addDays, todayInToronto, type ServiceDate } from '@/lib/time';
import type { Tables } from '@/lib/supabase/database.types';

/**
 * The operator dashboard's reads that are more than a select.
 *
 * Both go through `rows()`: a refused RPC — a missing grant, a renamed
 * argument — would otherwise arrive as an empty array and render as "you have
 * not run anything yet", which is the exact failure `lib/supabase/rows.ts`
 * exists to stop.
 */

export async function operatorInsights(
  operatorId: string,
  days: number,
  today: ServiceDate = todayInToronto(),
): Promise<Insights & { from: ServiceDate; to: ServiceDate }> {
  const from = addDays(today, -days);

  const supabase = await createClient();
  const raw = rows(
    await supabase.rpc('operator_insights', {
      p_operator_id: operatorId,
      p_from: from,
      p_to: today,
    }),
    'your insights',
  );

  return { ...summarize(raw), from, to: today };
}

export type VoucherWithUses = Tables<'vouchers'> & {
  uses: number;
  givenAwayCents: number;
};

/**
 * Every code this operator has issued, with how far each has got.
 *
 * The use count comes from `voucher_uses()` rather than from counting
 * bookings here, because "a use" has a definition — it excludes a hold that
 * has lapsed — and that definition is the one `resolve_voucher()` enforces.
 * Two answers to that question is one too many.
 */
export async function operatorVouchers(operatorId: string): Promise<VoucherWithUses[]> {
  const supabase = await createClient();

  const [voucherResult, useResult] = await Promise.all([
    supabase
      .from('vouchers')
      .select('*')
      .eq('operator_id', operatorId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('voucher_uses', { p_operator_id: operatorId }),
  ]);

  const vouchers = rows(voucherResult, 'your voucher codes');
  const uses = new Map(
    rows(useResult, 'how often your codes have been used').map((row) => [
      row.voucher_id,
      row,
    ]),
  );

  return vouchers.map((voucher) => ({
    ...voucher,
    uses: Number(uses.get(voucher.id)?.uses ?? 0),
    givenAwayCents: Number(uses.get(voucher.id)?.discount_cents ?? 0),
  }));
}
