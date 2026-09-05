import 'server-only';

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import { rows } from '@/lib/supabase/rows';
import type { NotificationKind as StoredNotificationKind } from '@/lib/supabase/database.types';
import { siteUrl } from '@/lib/supabase/env';

/**
 * One way to tell someone something.
 *
 * The MVP sends email through Resend. Because a hold lapses in an hour, SMS
 * may prove necessary for approval alerts — that is why this is a seam and not
 * a `resend.emails.send()` scattered through the actions. Adding a channel
 * should be one implementation here, not a refactor everywhere.
 *
 * Notifications never block the thing that triggered them. A booking that
 * succeeded and an email that failed is a booking that succeeded.
 */

export type NotificationKind =
  | 'seat_requested'
  | 'booking_approved'
  | 'booking_declined'
  | 'booking_cancelled'
  | 'departure_tomorrow'
  | 'payment_reminder'
  | 'incity_requested'
  | 'incity_approved'
  | 'incity_declined'
  | 'report_filed'
  | 'report_resolved'
  | 'feedback_filed'
  | 'login_code'
  | 'password_reset';

export type Notification = {
  kind: NotificationKind;
  subject: string;
  body: string;
  /** Path within the site, turned into an absolute link. */
  link?: string;
  bookingId?: string;
  /** Send to one passenger. */
  passengerId?: string;
  /** Send to everyone who can act for this operator (owners and staff). */
  operatorId?: string;
  /**
   * Send to every platform admin.
   *
   * A complaint reaches two audiences at once — the operator, who has to fix
   * it, and the platform, which has to know it happened. They are separate
   * calls rather than one recipient list, because they are separate messages:
   * the operator is told about their own trip, the admin about a pattern.
   */
  platformAdmins?: boolean;
  /**
   * Send to an address directly, without looking a user up first.
   *
   * This exists for account recovery, where the whole point is that nobody is
   * signed in and we must not confirm whether the address belongs to an
   * account. Everywhere else, address a person by id and let this module find
   * the address — that way a changed email is right everywhere at once.
   */
  to?: string[];
};

/**
 * A person to tell. The id is what files the in-app notification, the address
 * is what sends the email, and either can be missing: account recovery knows
 * an address and deliberately not who it belongs to.
 */
type Recipient = { userId: string | null; email: string | null };

/**
 * The kinds that carry a credential, and are therefore emailed and never
 * filed. Their recipient is by definition locked out, so an in-app list is the
 * one place they cannot look — and a working sign-in code is not something to
 * leave sitting in a table. `notification_kind` in the database omits them
 * too, so a slip here fails at the insert rather than quietly succeeding.
 */
const CREDENTIAL_KINDS: NotificationKind[] = ['login_code', 'password_reset'];

export async function notify(notification: Notification): Promise<void> {
  try {
    const recipients = await resolveRecipients(notification);
    if (recipients.length === 0) return;

    // Filed first. Email is the channel most likely to fail — no key, an
    // unverified sender, a bounce — and the in-app copy is what the reader
    // actually has a way of seeing.
    await file(recipients, notification);

    const addresses = recipients
      .map((recipient) => recipient.email)
      .filter((email): email is string => Boolean(email));

    if (addresses.length > 0) await deliver(addresses, notification);
  } catch (error) {
    // Never let a notification failure roll back or block the caller.
    console.error('notify failed', notification.kind, error);
  }
}

async function resolveRecipients(notification: Notification): Promise<Recipient[]> {
  // An address the caller already has needs no lookup at all — and recovery
  // must not turn one into a user id, which is the question it refuses to
  // answer everywhere else.
  if (notification.to?.length) {
    return notification.to.map((email) => ({ userId: null, email }));
  }

  // Reading someone else's email address is exactly what the service-role key
  // is for: no policy should expose auth.users to a passenger or an operator.
  const admin = createAdminClient();

  if (notification.passengerId) {
    const { data } = await admin.auth.admin.getUserById(notification.passengerId);
    return [{ userId: notification.passengerId, email: data.user?.email ?? null }];
  }

  if (notification.operatorId) {
    // Unwrapped, not defaulted: a refused lookup here would notify nobody and
    // look exactly like an operator with no staff. notify()'s own catch turns
    // the throw into a log without touching the caller's work.
    const members = rows(
      await admin
        .from('operator_members')
        .select('user_id, role')
        .eq('operator_id', notification.operatorId)
        .in('role', ['owner', 'staff']),
      "the operator's team",
    );

    return withEmails(members.map((member) => member.user_id));
  }

  if (notification.platformAdmins) {
    // Nothing else in the codebase resolves who the admins are — the role is a
    // column on profiles with a partial index and no helper. This is that
    // helper, and it stays here rather than in a query module because the
    // service-role key is what makes reading other people's rows legitimate.
    const admins = rows(
      await admin.from('profiles').select('id').eq('platform_role', 'admin'),
      'the platform admins',
    );

    return withEmails(admins.map((row) => row.id));
  }

  return [];
}

/** Pairs user ids with the addresses only the service role may read. */
async function withEmails(userIds: string[]): Promise<Recipient[]> {
  const admin = createAdminClient();

  return Promise.all(
    userIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return { userId, email: data.user?.email ?? null };
    }),
  );
}

/**
 * Writes the in-app copy — the one that works with no sending domain, no SMS
 * provider, and nobody's inbox involved.
 */
async function file(recipients: Recipient[], notification: Notification): Promise<void> {
  if (CREDENTIAL_KINDS.includes(notification.kind)) return;

  const entries = recipients
    .filter((recipient) => recipient.userId)
    .map((recipient) => ({
      user_id: recipient.userId!,
      kind: notification.kind as StoredNotificationKind,
      subject: notification.subject,
      body: notification.body,
      link: notification.link ?? null,
      booking_id: notification.bookingId ?? null,
    }));

  if (entries.length === 0) return;

  const { error } = await createAdminClient().from('notifications').insert(entries);

  // Logged, never thrown: an approval that went through and a notification
  // that did not is still an approval that went through.
  if (error) console.error('[notify] could not file in-app copy', notification.kind, error);
}

async function deliver(recipients: string[], notification: Notification): Promise<void> {
  const link = notification.link ? `${siteUrl()}${notification.link}` : undefined;
  const apiKey = process.env.RESEND_API_KEY;

  // In development, and anywhere the key is absent, log instead of sending.
  // A missing key must never be a silent no-op you cannot see.
  if (!apiKey) {
    logInstead(recipients, notification, link, 'no RESEND_API_KEY');
    return;
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    // Falls back to Resend's sandbox sender, which is the only address that
    // works before a domain is verified. The previous default was a made-up
    // domain, so a project with a valid key and no NOTIFY_FROM_EMAIL got a
    // 403 on every send — the one configuration most likely to be hit first.
    //
    // The sandbox sender only delivers to the Resend account owner. Passengers
    // get nothing until a real domain is verified and set here.
    from: process.env.NOTIFY_FROM_EMAIL ?? 'Corridor <onboarding@resend.dev>',
    to: recipients,
    subject: notification.subject,
    text: link ? `${notification.body}\n\n${link}` : notification.body,
  });

  // The SDK reports a rejected send by RETURNING an error, not by throwing —
  // so notify()'s try/catch never sees it, and an unchecked call discards a
  // 403 whole. That is how an unverified from-address turned every recovery
  // email into "the email is on its way" plus a server log with nothing in it.
  //
  // Falling back to the log matters most on Resend's sandbox sender, which
  // delivers only to the account owner. Every other recipient's message is
  // refused, and this is the only thing that keeps the code inside it
  // readable — which is what makes recovery testable without a domain.
  if (error) {
    logInstead(recipients, notification, link, `Resend refused it — ${error.message}`);
  }
}

/**
 * The message, in full, somewhere a person can still act on it. A sign-in code
 * that failed to send is recoverable from here; one that was quietly dropped
 * is gone, and the passenger is left holding a screen that says it was sent.
 */
function logInstead(
  recipients: string[],
  notification: Notification,
  link: string | undefined,
  why: string,
): void {
  console.info(`[notify] not delivered (${why})`, {
    to: recipients,
    kind: notification.kind,
    subject: notification.subject,
    body: notification.body,
    link,
  });
}
