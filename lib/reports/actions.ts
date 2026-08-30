'use server';

import { revalidatePath } from 'next/cache';

import { requireViewer } from '@/lib/auth/session';
import { fail, parseForm, succeed, type FormState } from '@/lib/forms';
import { notify } from '@/lib/notify';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dynamicRoute } from '@/lib/routes';
import { feedbackSchema, reportSchema, resolveReportSchema } from '@/lib/validation/reports';

/**
 * Complaints and feedback.
 *
 * Thin, like every other action module: validate, authenticate, call the
 * function, tell someone. `file_report()` decides which operator a complaint
 * belongs to by reading the departure — there is no parameter for it, because
 * a caller who could name the operator could name the wrong one.
 */

export async function fileReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(reportSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireViewer(`/my-rides/${parsed.data.booking_id}`);

  const supabase = await createClient();
  const { data: reportId, error } = await supabase.rpc('file_report', {
    p_booking_id: parsed.data.booking_id,
    p_category: parsed.data.category,
    p_note: parsed.data.note,
  });

  if (error || !reportId) {
    // The function raises messages written for the person reading them.
    return fail(error?.message ?? 'We could not file that report. Try again in a moment.');
  }

  await notifyOfNewReport(reportId);

  revalidatePath(dynamicRoute(`/my-rides/${parsed.data.booking_id}`));
  return succeed(
    'Reported. The operator and Corridor have both been told, and you will hear back here.',
  );
}

export async function resolveReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(resolveReportSchema, formData);
  if (!parsed.ok) return parsed.state;

  await requireViewer('/');

  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_report', {
    p_id: parsed.data.report_id,
    p_resolution: parsed.data.resolution || null,
  });

  if (error) return fail(error.message);

  await notifyReporterOfResolution(parsed.data.report_id);

  revalidatePath('/admin/complaints');
  if (parsed.data.operator_id) {
    revalidatePath(dynamicRoute(`/operator/${parsed.data.operator_id}/complaints`));
  }
  return succeed('Closed.');
}

export async function sendFeedback(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(feedbackSchema, formData);
  if (!parsed.ok) return parsed.state;

  const viewer = await requireViewer('/feedback');

  const supabase = await createClient();
  const { error } = await supabase.from('feedback').insert({
    user_id: viewer.userId,
    kind: parsed.data.kind,
    message: parsed.data.message,
  });

  if (error) return fail('We could not send that. Try again in a moment.');

  await notify({
    kind: 'feedback_filed',
    platformAdmins: true,
    subject: `New ${parsed.data.kind} from a Corridor user`,
    body: parsed.data.message,
    link: '/admin/feedback',
  });

  revalidatePath('/feedback');
  return succeed('Sent. Thank you — a person really does read these.');
}

/* ------------------------------------------------------------- plumbing */

/**
 * Two calls, two audiences. The operator is being told about their own trip;
 * the platform is being told that a complaint exists at all. Merging them into
 * one recipient list would mean writing one message that suits neither.
 */
async function notifyOfNewReport(reportId: string): Promise<void> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('reports')
    .select('id, operator_id, booking_id, category')
    .eq('id', reportId)
    .maybeSingle();

  if (!data) return;

  await notify({
    kind: 'report_filed',
    operatorId: data.operator_id,
    bookingId: data.booking_id,
    subject: 'A passenger has reported a trip',
    body: `Someone has raised a problem about a trip you ran (${data.category}). It is waiting in your complaints.`,
    link: `/operator/${data.operator_id}/complaints`,
  });

  await notify({
    kind: 'report_filed',
    platformAdmins: true,
    bookingId: data.booking_id,
    subject: 'A passenger has reported an operator',
    body: `A ${data.category} complaint has been filed. The operator has been told as well.`,
    link: '/admin/complaints',
  });
}

/** A complaint that vanishes is worse than no complaint box at all. */
async function notifyReporterOfResolution(reportId: string): Promise<void> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('reports')
    .select('reporter_id, booking_id, resolution')
    .eq('id', reportId)
    .maybeSingle();

  if (!data?.reporter_id) return;

  await notify({
    kind: 'report_resolved',
    passengerId: data.reporter_id,
    bookingId: data.booking_id,
    subject: 'Your report has been looked at',
    body: data.resolution
      ? `Someone has closed your report: "${data.resolution}"`
      : 'Someone has closed your report.',
    link: `/my-rides/${data.booking_id}`,
  });
}
