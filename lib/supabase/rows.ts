/**
 * Reading a PostgREST result without throwing the error away.
 *
 * `const { data } = await supabase.from(…).select(…)` then `data ?? []` is the
 * most dangerous line in this codebase. PostgREST answers a refused query with
 * `error` set and `data` null — an ambiguous embed, a missing grant, a
 * malformed select — and `?? []` turns every one of those into an empty list
 * that renders as a perfectly calm "Nothing here yet". The complaints page told
 * two operators they had no complaints for as long as it existed, and nothing
 * anywhere said otherwise.
 *
 * These two functions make that mistake loud. A refused query throws, the error
 * boundary says something went wrong, and the reason is in the server log. What
 * they deliberately do **not** touch is an honest empty result: RLS hides rows
 * by returning fewer of them, never by erroring, so "you may not see this" and
 * "this is broken" stay the different things they are.
 */

/**
 * Structural, not `PostgrestError`, so a test can write one down. Supabase's
 * class satisfies it.
 */
export type QueryError = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

/**
 * `.single()` on nothing. Not a failure — the caller asked whether a row was
 * there and the answer was no.
 */
const NO_ROWS = 'PGRST116';

function describe(error: QueryError, what: string): string {
  const parts = [error.message];
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(`Hint: ${error.hint}`);
  const code = error.code ? ` [${error.code}]` : '';
  return `Reading ${what} failed${code}: ${parts.join(' — ')}`;
}

/**
 * A Supabase result is a union — data set and error null, or the other way
 * about — so the element type is dug out of it rather than inferred from a
 * parameter, which would collapse to `never` on the error half of the union.
 */
type Result = { data: unknown; error: QueryError | null };
type Element<R> = R extends { data: infer D }
  ? D extends readonly (infer E)[]
    ? E
    : never
  : never;
type Single<R> = R extends { data: infer D } ? (D extends null ? never : D) : never;

/** The list a query returned, or a thrown error if it did not return one. */
export function rows<R extends Result>(result: R, what: string): Element<R>[] {
  if (result.error) throw new Error(describe(result.error, what));
  return (result.data ?? []) as Element<R>[];
}

/**
 * The number a `{ count: 'exact', head: true }` query returned. A refused count
 * comes back as null, and `?? 0` reads as a real zero — which on the operator
 * checklist is the difference between "you have not added a stop yet" and "we
 * could not ask".
 */
export function count(
  result: { count: number | null; error: QueryError | null },
  what: string,
): number {
  if (result.error) throw new Error(describe(result.error, what));
  return result.count ?? 0;
}

/**
 * The one row a query returned, `null` if there genuinely is none, and a thrown
 * error if the question could not be asked. Callers turn the `null` into a 404;
 * that is the whole point of separating it from the throw.
 */
export function one<R extends Result>(result: R, what: string): Single<R> | null {
  if (result.error && result.error.code !== NO_ROWS) {
    throw new Error(describe(result.error, what));
  }
  return (result.data ?? null) as Single<R> | null;
}
