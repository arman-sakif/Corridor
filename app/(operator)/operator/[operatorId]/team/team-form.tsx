'use client';

import { useActionState } from 'react';

import { addTeamMember } from '@/lib/operator/actions';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';

export function TeamForm({ operatorId }: { operatorId: string }) {
  const [state, action] = useActionState(addTeamMember, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Field label="Their email" error={fieldError(state, 'email')}>
        <Input name="email" type="email" required />
      </Field>

      <Field label="What they can do" error={fieldError(state, 'role')}>
        <Select name="role" defaultValue="driver">
          <option value="driver">Driver — their own trips and passenger lists</option>
          <option value="staff">Staff — routes, fares, and seat requests</option>
          <option value="owner">Owner — everything, including the team</option>
        </Select>
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Adding…">Add to team</SubmitButton>
    </form>
  );
}
