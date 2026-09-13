import type { Metadata } from 'next';

import { ProfileForm } from './profile-form';
import { setAccountType } from '@/lib/auth/mode-actions';
import { MODE_BLURB, MODE_LABEL, availableModes, toggleableModes } from '@/lib/auth/modes';
import { requireViewer } from '@/lib/auth/session';
import { safeRedirectPath } from '@/lib/auth/routing';
import { Alert, Badge, Button, Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Your details' };

const TOGGLE_LABEL = { passenger: 'Passenger', driver: 'Driving' } as const;

const TOGGLE_HINT = {
  passenger: 'Book seats for yourself and keep track of your own rides.',
  driver: 'Drive your own departures and open their passenger lists.',
} as const;

/** What the last switch did, carried back in the URL by `setAccountType`. */
const TYPE_MESSAGES: Record<string, { tone: 'good' | 'bad'; text: string }> = {
  'on-passenger': { tone: 'good', text: 'Passenger is on. Use Switch in the header to book as a passenger.' },
  'off-passenger': { tone: 'good', text: 'Passenger is off.' },
  'on-driver': { tone: 'good', text: 'Driving is on. Use Switch in the header to open your trips.' },
  'off-driver': { tone: 'good', text: 'Driving is off.' },
  refused: { tone: 'bad', text: 'That change is not available to your account.' },
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; types?: string }>;
}) {
  const params = await searchParams;
  const viewer = await requireViewer('/profile');
  const next = params.next ? safeRedirectPath(params.next, '/') : undefined;
  const needsPhone = !viewer.profile?.phone;

  // Types they can switch themselves, and the ones granted to them, which they
  // cannot. A plain passenger has neither to show, so the section stays away.
  const toggles = toggleableModes(viewer);
  const granted = availableModes(viewer).filter(
    (mode) => !toggles.some((toggle) => toggle.mode === mode),
  );
  const message = params.types ? TYPE_MESSAGES[params.types] : undefined;

  return (
    <>
      <PageHeader
        title="Your details"
        description="Operators see this when they decide on your seat request."
      />

      {needsPhone ? (
        <div className="mb-6">
          <Alert tone="info">
            Add your name and phone number so the driver can reach you on the day.
          </Alert>
        </div>
      ) : null}

      <Card className="p-6">
        <ProfileForm profile={viewer.profile} email={viewer.email} next={next} />
      </Card>

      {toggles.length > 0 ? (
        <Card className="mt-6 p-6">
          <h2 className="font-semibold text-ink-900">Account types</h2>
          <p className="mt-1 text-sm text-ink-600">
            Every type signs in with this email and password. With more than one, Corridor asks
            which to use when you sign in, and Switch in the header changes it.
          </p>

          {message ? (
            <div className="mt-4">
              <Alert tone={message.tone}>{message.text}</Alert>
            </div>
          ) : null}

          <ul className="mt-4 divide-y divide-ink-150">
            {granted.map((mode) => (
              <li key={mode} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{MODE_LABEL[mode]}</p>
                  <p className="text-sm text-ink-600">{MODE_BLURB[mode]}</p>
                </div>
                <Badge tone="neutral">
                  {mode === 'admin' ? 'Given by Corridor' : 'Given by your business'}
                </Badge>
              </li>
            ))}

            {toggles.map((toggle) => (
              <li
                key={toggle.mode}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-ink-900">
                    {TOGGLE_LABEL[toggle.mode]}
                    <Badge tone={toggle.enabled ? 'good' : 'neutral'}>
                      {toggle.enabled ? 'On' : 'Off'}
                    </Badge>
                  </p>
                  <p className="text-sm text-ink-600">{TOGGLE_HINT[toggle.mode]}</p>
                </div>

                <form action={setAccountType}>
                  <input type="hidden" name="mode" value={toggle.mode} />
                  <input type="hidden" name="enabled" value={toggle.enabled ? 'off' : 'on'} />
                  <Button type="submit" size="sm" tone={toggle.enabled ? 'secondary' : 'primary'}>
                    {toggle.enabled
                      ? `Turn off ${TOGGLE_LABEL[toggle.mode].toLowerCase()}`
                      : `Turn on ${TOGGLE_LABEL[toggle.mode].toLowerCase()}`}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
