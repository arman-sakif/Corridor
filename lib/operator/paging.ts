/**
 * Walking a paginated API until something is found.
 *
 * This exists because `auth.admin.listUsers()` is paginated and defaults to
 * the first 50. Called bare — as `addTeamMember` did — it stops seeing people
 * the moment the platform has more accounts than one page, and the failure is
 * silent and actively misleading: an owner is told "nobody signs in with that
 * email yet" about a colleague who plainly does, and the only apparent remedy
 * is to sign up again with an address that is already taken.
 *
 * The paging is separated from the calling of GoTrue so it can be tested
 * without one. The bug was never in the lookup; it was in the walking.
 *
 * Pure: no imports, no client, no network.
 */

/** GoTrue's maximum. Fewer pages is fewer round trips. */
export const USERS_PER_PAGE = 1000;

/**
 * A ceiling so a misbehaving API cannot spin this forever. Fifty pages of a
 * thousand is far past the point where a different lookup is needed anyway.
 */
export const MAX_PAGES = 50;

export type FetchPage<T> = (page: number, perPage: number) => Promise<T[] | null>;

/**
 * @param fetchPage One page, 1-indexed. Return `null` for a failure — the
 *   search stops and answers "not found" rather than guessing.
 * @returns The first matching item, or `null` if there is none.
 */
export async function findAcrossPages<T>(
  fetchPage: FetchPage<T>,
  matches: (item: T) => boolean,
  { perPage = USERS_PER_PAGE, maxPages = MAX_PAGES }: { perPage?: number; maxPages?: number } = {},
): Promise<T | null> {
  for (let page = 1; page <= maxPages; page += 1) {
    const items = await fetchPage(page, perPage);
    if (!items) return null;

    const found = items.find(matches);
    if (found) return found;

    // A short page is the last page — asking for another would be a round trip
    // to learn nothing.
    if (items.length < perPage) return null;
  }

  console.error('findAcrossPages gave up', { maxPages, perPage });
  return null;
}
