import type { Metadata } from 'next';
import Link from 'next/link';

import { OperatorApplicationForm } from './application-form';
import { getViewer } from '@/lib/auth/session';
import { Alert, ButtonLink, Card } from '@/components/ui';
import { dynamicRoute } from '@/lib/routes';

export const metadata: Metadata = { title: 'List your business' };

export default async function ForOperatorsPage() {
  const viewer = await getViewer();
  const existing = viewer?.memberships.filter((m) => m.role === 'owner') ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
        Put your timetable online
      </h1>
      <p className="mt-2 text-ink-600">
        You already run the route. Corridor takes the bookings, so you stop copying names out of
        WhatsApp and into a notebook.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          'Passengers see your departures beside everyone else’s and book a seat directly.',
          'You approve or decline every request. Nobody rides without your say-so.',
          'You set your own fares, per segment or per leg, and change them whenever you like.',
          'Print a passenger list per vehicle on the morning of the trip.',
        ].map((line) => (
          <li key={line} className="rounded-xl bg-white p-4 text-sm text-ink-700 ring-1 ring-ink-200">
            {line}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-ink-600">
        Payment still happens between you and the passenger — cash or e-transfer, on the day. No
        money moves through Corridor.
      </p>

      <div className="mt-10">
        {existing.length > 0 ? (
          <Card className="p-6">
            <h2 className="font-semibold text-ink-900">You already have a business here</h2>
            <div className="mt-4 space-y-3">
              {existing.map((membership) => (
                <div key={membership.operator_id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink-900">{membership.operator?.name}</p>
                    <p className="text-sm text-ink-600">
                      {membership.operator?.status === 'active'
                        ? 'Live in passenger search.'
                        : membership.operator?.status === 'pending'
                          ? 'Waiting on the Corridor team to vet it.'
                          : 'Suspended. Get in touch to sort it out.'}
                    </p>
                  </div>
                  <ButtonLink href={dynamicRoute(`/operator/${membership.operator_id}`)} tone="secondary">
                    Open dashboard
                  </ButtonLink>
                </div>
              ))}
            </div>
          </Card>
        ) : viewer ? (
          <Card className="p-6">
            <h2 className="font-semibold text-ink-900">Apply to list your business</h2>
            <p className="mt-1 mb-5 text-sm text-ink-600">
              Someone from Corridor checks every business before it appears in search. You can set
              up your routes and fares while you wait.
            </p>
            <OperatorApplicationForm />
          </Card>
        ) : (
          <Card className="p-6">
            <Alert tone="info">
              Create an account first — it takes a moment, and it becomes your owner login.
            </Alert>
            <div className="mt-4 flex gap-3">
              <ButtonLink href="/sign-up?next=/for-operators">Create account</ButtonLink>
              <Link
                href="/sign-in?next=/for-operators"
                className="inline-flex items-center px-2 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                or sign in
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
