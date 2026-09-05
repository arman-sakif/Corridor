import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { IconInfo } from '@/components/icons';
import { createClient } from '@/lib/supabase/server';
import { rows } from '@/lib/supabase/rows';
import { formatRelative } from '@/lib/time';

type Row = {
  id: string;
  kind: 'idea' | 'problem' | 'praise' | 'other';
  message: string;
  created_at: string;
  author: { full_name: string | null } | null;
};

const tone = { idea: 'brand', problem: 'warn', praise: 'good', other: 'neutral' } as const;

/**
 * What people wish Corridor did.
 *
 * Unsorted beyond newest-first and unfiltered on purpose: the value in a list
 * like this is reading it, and any triage state would be one more thing to
 * maintain before there is enough here to need it.
 */
export default async function AdminFeedbackPage() {
  const supabase = await createClient();
  const items = rows(
    await supabase
      .from('feedback')
      .select('id, kind, message, created_at, author:profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(200),
    'the feedback',
  ) as unknown as Row[];

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Ideas and annoyances sent by passengers, drivers and operators."
      />

      {items.length === 0 ? (
        <Card className="p-6">
          <EmptyState icon={<IconInfo />} title="Nothing yet">
            Anyone signed in can send something from their Tell us something page.
          </EmptyState>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((row) => (
            <li key={row.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone[row.kind]}>{row.kind}</Badge>
                  <span className="text-sm font-medium text-ink-900">
                    {row.author?.full_name ?? 'Someone'}
                  </span>
                  <span className="text-xs text-ink-500">{formatRelative(row.created_at)}</span>
                </div>
                <p className="mt-2 text-sm text-ink-800">{row.message}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
