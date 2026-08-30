'use client';

import { useActionState, useState } from 'react';

import { saveRoute } from '@/lib/operator/setup';
import { FormMessage, SubmitButton, fieldError } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';
import { idleState } from '@/lib/forms';

type StopOption = { id: string; label: string };

/**
 * The two pricing modes are explained with the operator's own numbers, never
 * with the words "matrix" and "additive" — those are our words, not theirs.
 */
export function RouteForm({
  operatorId,
  stops,
}: {
  operatorId: string;
  stops: StopOption[];
}) {
  const [state, action] = useActionState(saveRoute, idleState);
  const [chosen, setChosen] = useState<string[]>([]);
  const [mode, setMode] = useState<'matrix' | 'additive'>('matrix');

  const remaining = stops.filter((stop) => !chosen.includes(stop.id));
  const labelOf = (id: string) => stops.find((s) => s.id === id)?.label ?? id;

  const move = (index: number, delta: number) => {
    const next = [...chosen];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setChosen(next);
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="operator_id" value={operatorId} />
      {chosen.map((id) => (
        <input key={id} type="hidden" name="stop_ids" value={id} />
      ))}

      <Field label="Route name" error={fieldError(state, 'name')}>
        <Input name="name" placeholder="Windsor to Toronto" required />
      </Field>

      <Field label="Stops, in the order you drive them" error={fieldError(state, 'stop_ids')}>
        <div className="space-y-2">
          {chosen.length === 0 ? (
            <p className="rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-600">
              Nothing added yet. Pick the stop you leave from first.
            </p>
          ) : (
            <ol className="space-y-1">
              {chosen.map((id, index) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-lg bg-ink-100 px-3 py-2 text-sm"
                >
                  <span className="numeric w-5 text-ink-500">{index + 1}</span>
                  <span className="flex-1 text-ink-900">{labelOf(id)}</span>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    className="px-1 text-ink-500 hover:text-ink-900 disabled:opacity-30"
                    aria-label={`Move ${labelOf(id)} earlier`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === chosen.length - 1}
                    className="px-1 text-ink-500 hover:text-ink-900 disabled:opacity-30"
                    aria-label={`Move ${labelOf(id)} later`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setChosen(chosen.filter((c) => c !== id))}
                    className="px-1 text-ink-500 hover:text-bad-700"
                    aria-label={`Remove ${labelOf(id)}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}

          <Select
            value=""
            onChange={(event) => {
              if (event.target.value) setChosen([...chosen, event.target.value]);
            }}
            disabled={remaining.length === 0}
          >
            <option value="">
              {remaining.length === 0 ? 'Every stop is on this route' : 'Add a stop…'}
            </option>
            {remaining.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {stop.label}
              </option>
            ))}
          </Select>
        </div>
      </Field>

      <Field label="How you price it">
        <div className="space-y-2">
          <label className="flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-ink-200 has-checked:bg-brand-50 has-checked:ring-brand-500">
            <input
              type="radio"
              name="pricing_mode"
              value="matrix"
              checked={mode === 'matrix'}
              onChange={() => setMode('matrix')}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="block font-medium text-ink-900">
                I set a price for each pair of stops
              </span>
              <span className="mt-1 block text-ink-600">
                Windsor to London $30, London to Toronto $35, and Windsor all the way to Toronto
                $45 — because you would not charge $65 for the through trip.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer gap-3 rounded-lg p-3 ring-1 ring-ink-200 has-checked:bg-brand-50 has-checked:ring-brand-500">
            <input
              type="radio"
              name="pricing_mode"
              value="additive"
              checked={mode === 'additive'}
              onChange={() => setMode('additive')}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="block font-medium text-ink-900">
                I price each hop, and they add up
              </span>
              <span className="mt-1 block text-ink-600">
                Windsor to London $30 and London to Toronto $35 means Windsor to Toronto is $65.
                Fewer prices to type, but no discount on the long trip.
              </span>
            </span>
          </label>
        </div>
      </Field>

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Saving…">Create route</SubmitButton>

      {stops.length < 2 ? (
        <p className="text-sm text-ink-500">
          You need at least two stops before you can build a route.
        </p>
      ) : null}
    </form>
  );
}
