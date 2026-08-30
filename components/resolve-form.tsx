'use client';

import { useActionState } from 'react';

import { resolveReport } from '@/lib/reports/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Input } from '@/components/ui';
import { idleState } from '@/lib/forms';

/**
 * Closing a complaint.
 *
 * The note is optional but prompted for, because it is what the passenger
 * receives: "someone closed your report" and "we spoke to the driver, it will
 * not happen again" are the difference between a complaints box and a bin.
 */
export function ResolveForm({
  reportId,
  operatorId,
}: {
  reportId: string;
  operatorId: string;
}) {
  const [state, action] = useActionState(resolveReport, idleState);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="report_id" value={reportId} />
      <input type="hidden" name="operator_id" value={operatorId} />

      <div className="flex flex-wrap gap-2">
        <Input
          name="resolution"
          placeholder="What you did about it — the passenger sees this"
          className="min-w-0 flex-1"
        />
        <SubmitButton tone="secondary" pendingLabel="Closing…">
          Close
        </SubmitButton>
      </div>

      {fieldError(state, 'resolution') ? (
        <p className="text-xs font-medium text-bad-700">{fieldError(state, 'resolution')}</p>
      ) : null}

      <FormMessage state={state} />
    </form>
  );
}
