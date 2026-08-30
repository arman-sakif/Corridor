import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, EmptyState } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Operators' };

export default async function OperatorsPage() {
  const supabase = await createClient();

  // RLS shows only active operators here, so a pending or suspended business
  // is invisible without any filter of our own.
  // Filtered in the query rather than afterwards. PostgREST caps a select at
  // 1000 rows, so filtering the page in memory would start silently dropping
  // intercity operators the moment the table outgrew that — and a short list
  // reads exactly like a complete one.
  const { data: operators } = await supabase
    .from('operators')
    .select('id, name, bio, public_phone, type')
    .eq('type', 'intercity')
    .order('name');

  const rows = operators ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
        Operators on Corridor
      </h1>
      <p className="mt-1 text-ink-600">
        Independent businesses running their own vehicles and their own timetables. Corridor checks
        each one before it appears here.
      </p>

      <div className="mt-8">
        {rows.length === 0 ? (
          <EmptyState title="No operators listed yet">
            The first businesses are being vetted. Check back shortly.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {rows.map((operator) => (
              <li key={operator.id}>
                <Link href={`/operators/${operator.id}`}>
                  <Card className="p-5 transition-shadow hover:shadow-sm">
                    <p className="font-semibold text-ink-900">{operator.name}</p>
                    {operator.bio ? (
                      <p className="mt-1 text-sm text-ink-600">{operator.bio}</p>
                    ) : null}
                    {operator.public_phone ? (
                      <p className="numeric mt-2 text-sm text-ink-500">{operator.public_phone}</p>
                    ) : null}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
