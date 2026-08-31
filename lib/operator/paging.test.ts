import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findAcrossPages } from './paging.ts';

/**
 * The bug this guards against: `addTeamMember` called `listUsers()` bare, which
 * returns the first 50 users, so adding a colleague started failing silently
 * once the platform outgrew one page. Every test below that mentions a later
 * page is that bug.
 */

/** A fake paginated API over a fixed list, counting the pages it served. */
function pagedOver(items: string[]) {
  const served: number[] = [];
  const fetchPage = async (page: number, perPage: number) => {
    served.push(page);
    return items.slice((page - 1) * perPage, page * perPage);
  };
  return { fetchPage, served };
}

const users = (count: number) => Array.from({ length: count }, (_, i) => `user-${i}@example.com`);

describe('findAcrossPages', () => {
  it('finds someone on the first page without asking for a second', async () => {
    const { fetchPage, served } = pagedOver(users(2500));

    const found = await findAcrossPages(fetchPage, (u) => u === 'user-7@example.com', {
      perPage: 1000,
    });

    assert.equal(found, 'user-7@example.com');
    assert.deepEqual(served, [1], 'one page was enough');
  });

  it('finds someone past the first page — the whole point', async () => {
    const { fetchPage, served } = pagedOver(users(2500));

    const found = await findAcrossPages(fetchPage, (u) => u === 'user-2400@example.com', {
      perPage: 1000,
    });

    assert.equal(found, 'user-2400@example.com');
    assert.deepEqual(served, [1, 2, 3], 'it kept going until it found them');
  });

  it('finds the very last person, on a short final page', async () => {
    const { fetchPage } = pagedOver(users(2500));

    const found = await findAcrossPages(fetchPage, (u) => u === 'user-2499@example.com', {
      perPage: 1000,
    });

    assert.equal(found, 'user-2499@example.com');
  });

  it('stops at a short page rather than asking for one more', async () => {
    const { fetchPage, served } = pagedOver(users(2500));

    const found = await findAcrossPages(fetchPage, (u) => u === 'nobody@example.com', {
      perPage: 1000,
    });

    assert.equal(found, null);
    assert.deepEqual(served, [1, 2, 3], 'page 3 was short, so there was no page 4');
  });

  it('stops on a failed page instead of guessing', async () => {
    const served: number[] = [];
    const found = await findAcrossPages(
      async (page) => {
        served.push(page);
        return page === 2 ? null : users(1000);
      },
      () => false,
      { perPage: 1000 },
    );

    assert.equal(found, null);
    assert.deepEqual(served, [1, 2], 'it did not carry on past the failure');
  });

  it('gives up at the cap rather than paging forever', async () => {
    // An API that always returns a full page would otherwise loop until the
    // request timed out.
    let calls = 0;
    const found = await findAcrossPages(
      async () => {
        calls += 1;
        return users(10);
      },
      () => false,
      { perPage: 10, maxPages: 4 },
    );

    assert.equal(found, null);
    assert.equal(calls, 4);
  });

  it('handles an empty first page', async () => {
    const { fetchPage } = pagedOver([]);
    assert.equal(await findAcrossPages(fetchPage, () => true, { perPage: 1000 }), null);
  });
});
