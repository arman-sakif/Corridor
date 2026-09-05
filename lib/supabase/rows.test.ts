import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { count, one, rows } from './rows.ts';

describe('rows', () => {
  it('returns what came back', () => {
    assert.deepEqual(rows({ data: [{ id: 'a' }], error: null }, 'cities'), [{ id: 'a' }]);
  });

  it('treats no rows as an empty list, not a problem', () => {
    assert.deepEqual(rows({ data: [], error: null }, 'cities'), []);
    assert.deepEqual(rows({ data: null, error: null }, 'cities'), []);
  });

  it('throws rather than pass an error off as an empty list', () => {
    assert.throws(
      () =>
        rows(
          {
            data: null,
            error: {
              message: "Could not embed because more than one relationship was found",
              code: 'PGRST201',
              details: null,
              hint: "Try 'profiles!reports_reporter_id_fkey'",
            },
          },
          'complaints',
        ),
      /Reading complaints failed \[PGRST201\].*more than one relationship.*Hint: /s,
    );
  });
});

describe('one', () => {
  it('returns the row, or null when there is none', () => {
    assert.deepEqual(one({ data: { id: 'a' }, error: null }, 'booking'), { id: 'a' });
    assert.equal(one({ data: null, error: null }, 'booking'), null);
  });

  it('reads .single() finding nothing as absence, so the caller can 404', () => {
    assert.equal(
      one({ data: null, error: { message: 'no rows', code: 'PGRST116' } }, 'booking'),
      null,
    );
  });

  it('throws on a refused query, which is not the same as absence', () => {
    assert.throws(
      () => one({ data: null, error: { message: 'permission denied', code: '42501' } }, 'booking'),
      /Reading booking failed \[42501\]: permission denied/,
    );
  });
});

describe('count', () => {
  it('returns the count, and reads a missing one as zero', () => {
    assert.equal(count({ count: 4, error: null }, 'stops'), 4);
    assert.equal(count({ count: null, error: null }, 'stops'), 0);
  });

  it('will not pass a refused count off as zero', () => {
    assert.throws(
      () => count({ count: null, error: { message: 'permission denied for table stops' } }, 'stops'),
      /Reading stops failed: permission denied/,
    );
  });
});
