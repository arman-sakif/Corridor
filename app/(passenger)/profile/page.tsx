import type { Metadata } from 'next';

import { ProfileForm } from './profile-form';
import { requireViewer } from '@/lib/auth/session';
import { safeRedirectPath } from '@/lib/auth/routing';
import { Alert, Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Your details' };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const viewer = await requireViewer('/profile');
  const next = params.next ? safeRedirectPath(params.next, '/') : undefined;
  const needsPhone = !viewer.profile?.phone;

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
    </>
  );
}
