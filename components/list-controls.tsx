import Form from 'next/form';

import { Button, ButtonLink, Field, Input, Select } from '@/components/ui';
import {
  PAGE_SIZE,
  STATUS_FILTERS,
  STATUS_FILTER_KEYS,
  filtersActive,
  listHref,
  sortLabel,
  type Audience,
  type ListParams,
  type SortKey,
} from '@/lib/booking/ride-list';
import { dynamicRoute } from '@/lib/routes';

/**
 * Filter and sort for a list of bookings. A plain GET form: the choices land in
 * the URL, the server reads them, and the page needs no client state to keep
 * them — a refresh or a shared link shows the same list.
 */
export function ListControls({
  path,
  params,
  sorts,
  audience,
}: {
  path: string;
  params: ListParams;
  sorts: readonly SortKey[];
  audience: Audience;
}) {
  return (
    <Form
      action={dynamicRoute(path)}
      className="mb-6 rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink-200/70"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Status">
          <Select name="status" defaultValue={params.status ?? ''}>
            <option value="">Any status</option>
            {STATUS_FILTER_KEYS.map((key) => (
              <option key={key} value={key}>
                {STATUS_FILTERS[key][audience]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Departing on or after">
          <Input type="date" name="from" defaultValue={params.from ?? ''} />
        </Field>

        <Field label="Departing on or before">
          <Input type="date" name="to" defaultValue={params.to ?? ''} />
        </Field>

        <Field label="Sort">
          <Select name="sort" defaultValue={params.sort}>
            {sorts.map((sort) => (
              <option key={sort} value={sort}>
                {sortLabel(sort, audience)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {filtersActive(params) ? (
          <ButtonLink href={dynamicRoute(path)} tone="ghost">
            Clear filters
          </ButtonLink>
        ) : null}
        <Button type="submit">Apply</Button>
      </div>
    </Form>
  );
}

/** Previous and next, keeping every filter. Hidden when one page holds it all. */
export function Pager({
  path,
  params,
  total,
  defaultSort,
}: {
  path: string;
  params: ListParams;
  total: number;
  defaultSort: SortKey;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages === 1 && params.page === 1) return null;

  const previous =
    params.page > 1 ? listHref(path, params, { page: params.page - 1 }, defaultSort) : null;
  const next =
    params.page < pages ? listHref(path, params, { page: params.page + 1 }, defaultSort) : null;

  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-3">
      {previous ? (
        <ButtonLink href={dynamicRoute(previous)} tone="secondary" size="sm">
          ← Previous
        </ButtonLink>
      ) : (
        <span />
      )}
      <span className="numeric text-sm text-ink-600">
        Page {params.page} of {pages} · {total} in all
      </span>
      {next ? (
        <ButtonLink href={dynamicRoute(next)} tone="secondary" size="sm">
          Next →
        </ButtonLink>
      ) : (
        <span />
      )}
    </nav>
  );
}
