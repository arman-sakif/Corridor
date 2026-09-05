import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The guard on the habit, not just on the pages that had it.
 *
 * Every page in this app used to read `const { data } = await supabase…` and
 * then `data ?? []`, which turns a refused query into a convincing empty
 * state. It hid two real complaints from two operators for as long as that
 * page existed. `rows`, `one` and `count` exist so the failure is loud, and
 * this test is what stops the old shape coming back in the file after next —
 * the same job `grants.test.ts` does for a forgotten GRANT.
 *
 * Scope is the read surface: pages, layouts, route handlers, and the query
 * modules they call. Server Actions are deliberately outside it. They already
 * return a failure the form renders, and several of them read a row precisely
 * to find out whether it exists.
 */

const ROOTS = ['app', 'lib'];

const READ_SURFACE_FILES = ['queries.ts', 'search.ts', 'session.ts', 'notify.ts'];

const DESTRUCTURED = /const\s*\{\s*(?:data|count)\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function isReadSurface(path: string): boolean {
  const file = path.split(sep).join('/');
  if (file.endsWith('/page.tsx') || file.endsWith('/layout.tsx')) return true;
  if (file.endsWith('/route.ts')) return true;
  return READ_SURFACE_FILES.some((name) => file.endsWith(`/${name}`));
}

/**
 * The auth calls are not PostgREST. `auth.getUser()` and `getUserById()` have
 * no rows to lose and no policy to refuse them.
 */
function destructuresAResult(source: string): boolean {
  return source.split('\n').some((line) => DESTRUCTURED.test(line) && !line.includes('.auth.'));
}

describe('read paths', () => {
  it('unwrap their results instead of defaulting a refused query to nothing', () => {
    const offenders = ROOTS.flatMap(walk)
      .filter(isReadSurface)
      .filter((path) => destructuresAResult(readFileSync(path, 'utf8')));

    assert.deepEqual(
      offenders,
      [],
      'These read a Supabase result without unwrapping it. Use rows(), one() or ' +
        'count() from lib/supabase/rows, so a refused query throws instead of ' +
        `rendering as an empty page:\n  ${offenders.join('\n  ')}`,
    );
  });
});
