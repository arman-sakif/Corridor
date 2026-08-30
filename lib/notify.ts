import 'server-only';

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
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
   * Send to an address directly, without looking a user up first.
   *
   * This exists for account recovery, where the whole point is that nobody is
   * signed in and we must not confirm whether the address belongs to an
   * account. Everywhere else, address a person by id and let this module find
   * the address — that way a changed email is right everywhere at once.
   */
  to?: string[];
};

export async function notify(notification: Notification): Promise<void> {
  try {
    const recipients = await resolveRecipients(notification);
    if (recipients.length === 0) return;

    await deliver(recipients, notification);
  } catch (error) {
    // Never let a notification failure roll back or block the caller.
    console.error('notify failed', notification.kind, error);
  }
}

async function resolveRecipients(notification: Notification): Promise<string[]> {
  // An address the caller already has needs no lookup at all.
  if (notification.to?.length) return notification.to;

  // Reading someone else's email address is exactly what the service-role key
  // is for: no policy should expose auth.users to a passenger or an operator.
  const admin = createAdminClient();

  if (notification.passengerId) {
    const { data } = await admin.auth.admin.getUserById(notification.passengerId);
    return data.user?.email ? [data.user.email] : [];
  }

  if (notification.operatorId) {
    const { data: members } = await admin
      .from('operator_members')
      .select('user_id, role')
      .eq('operator_id', notification.operatorId)
      .in('role', ['owner', 'staff']);

    const emails = await Promise.all(
      (members ?? []).map(async (member) => {
        const { data } = await admin.auth.admin.getUserById(member.user_id);
        return data.user?.email ?? null;
      }),
    );

    return emails.filter((email): email is string => Boolean(email));
  }

  return [];
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
