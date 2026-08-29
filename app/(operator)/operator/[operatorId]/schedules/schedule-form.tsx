'use client';

import { useActionState } from 'react';

import { saveSchedule } from '@/lib/operator/setup';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';
import { DAY_NAMES, todayInToronto } from '@/lib/time';

export function ScheduleForm({
  operatorId,
  routes,
}: {
  operatorId: string;
  routes: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveSchedule, idleState);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />

      <Field label="Route" error={fieldError(state, 'route_id')}>
        <Select name="route_id" required defaultValue="">
          <option value="" disabled>
            Choose a route
          </option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Leaves at"
        hint="Ontario time, from the first stop on the route."
        error={fieldError(state, 'departure_time')}
      >
        <Input name="departure_time" type="time" defaultValue="09:00" required />
      </Field>

      <Field label="Days it runs" error={fieldError(state, 'days_of_week')}>
        <div className="flex flex-wrap gap-1">
          {DAY_NAMES.map((name, index) => (
            <label
              key={name}
              className="cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 ring-ink-200 select-none has-checked:bg-brand-600 has-checked:text-white has-checked:ring-brand-600"
            >
              <input type="checkbox" name="days_of_week" value={index} className="sr-only" />
              {name}
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Seats per departure"
        hint="The most passengers you can carry on any one stretch of the route."
        error={fieldError(state, 'max_seats')}
      >
        <Input name="max_seats" type="number" min={1} max={60} defaultValue={14} required />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts" error={fieldError(state, 'active_from')}>
          <Input name="active_from" type="date" defaultValue={todayInToronto()} required />
        </Field>
        <Field label="Ends (optional)" error={fieldError(state, 'active_to')}>
          <Input name="active_to" type="date" />
        </Field>
      </div>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Putting on sale…">Put on sale</SubmitButton>

      {routes.length === 0 ? (
        <p className="text-sm text-ink-500">
          Build a route with at least two stops first — a timetable needs somewhere to go.
        </p>
      ) : null}
    </form>
  );
}
