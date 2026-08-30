import type { Metadata } from 'next';

import { FeedbackForm } from './feedback-form';
import { requireViewer } from '@/lib/auth/session';
import { Card, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { formatRelative } from '@/lib/time';

export const metadata: Metadata = { title: 'Tell us something' };

/**
 * Feedback about the product rather than about a trip.
 *
 * Open to anyone signed in — passenger, driver or operator owner — because the
 * person who notices a missing button is whoever was reaching for it, and
 * limiting this to paying operators would mean never hearing about the booking
 * flow from anyone who uses it.
 *
 * A complaint about a specific trip is a report, and it lives on the booking.
 */
export default async function FeedbackPage() {
  const viewer = await requireViewer('/feedback');

  const supabase = await createClient();
  const { data: mine } = await supabase
    .from('feedback')
    .select('id, kind, message, created_at')
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <>
      <PageHeader
        title="Tell us something"
        description="An idea, an annoyance, or something that worked. It goes to the people who build Corridor."
      />

      <Card className="p-5">
        <FeedbackForm />
      </Card>

      {(mine ?? []).length > 0 ? (
        <div className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-ink-500 uppercase">
            What you have sent
          </h2>
          <ul className="mt-3 space-y-2">
            {(mine ?? []).map((item) => (
              <li key={item.id}>
                <Card className="p-4">
                  <p className="text-xs text-ink-500">
                    {item.kind} · {formatRelative(item.created_at)}
                  </p>
                  <p className="mt-1 text-sm text-ink-800">{item.message}</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
