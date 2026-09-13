import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CURRENT_SORTS,
  HISTORY_SORTS,
  effectiveStatus,
  isWaiting,
  listHref,
  parseListParams,
  sortRides,
  statusClause,
  type ListParams,
  type SortableRide,
} from './ride-list.ts';

const NOW = new Date('2026-09-03T12:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

function ride(id: string, partial: Partial<SortableRide>): SortableRide & { id: string } {
  return {
    id,
    status: 'approved',
    hold_expires_at: null,
    created_at: '2026-09-01T10:00:00+00:00',
    departure: { service_date: '2026-09-05', departure_time: '08:00:00' },
    ...partial,
  };
}

describe('parseListParams', () => {
  it('falls back to the default list for anything it does not recognise', () => {
    assert.deepEqual(
      parseListParams(
        { status: 'bogus', from: 'yesterday', to: '2026-02-30', sort: 'price', page: '-4' },
        CURRENT_SORTS,
      ),
      { status: null, from: null, to: null, sort: 'priority', page: 1 },
    );
  });

  it('reads a well-formed query', () => {
    assert.deepEqual(
      parseListParams(
        { status: 'waiting', from: '2026-09-01', to: '2026-09-10', sort: 'requested', page: '3' },
        CURRENT_SORTS,
      ),
      { status: 'waiting', from: '2026-09-01', to: '2026-09-10', sort: 'requested', page: 3 },
    );
  });

  it('swaps a date range given the wrong way round', () => {
    const params = parseListParams({ from: '2026-09-10', to: '2026-09-01' }, CURRENT_SORTS);
    assert.equal(params.from, '2026-09-01');
    assert.equal(params.to, '2026-09-10');
  });

  it('only accepts the sorts the page offers', () => {
    assert.equal(parseListParams({ sort: 'priority' }, HISTORY_SORTS).sort, 'departure_latest');
  });

  it('takes the first of a repeated parameter, and treats a blank one as unset', () => {
    const params = parseListParams({ status: ['finished', 'waiting'], from: '' }, CURRENT_SORTS);
    assert.equal(params.status, 'finished');
    assert.equal(params.from, null);
  });
});

describe('sortRides', () => {
  const rides = [
    ride('confirmed', { departure: { service_date: '2026-09-05', departure_time: '08:00:00' } }),
    ride('waiting-later', {
      status: 'held',
      hold_expires_at: at(50),
      created_at: '2026-09-03T11:50:00+00:00',
      departure: { service_date: '2026-09-10', departure_time: '07:00:00' },
    }),
    ride('waiting-soon', {
      status: 'held',
      hold_expires_at: at(10),
      created_at: '2026-09-03T11:10:00+00:00',
      departure: { service_date: '2026-09-12', departure_time: '07:00:00' },
    }),
    ride('lapsed', {
      status: 'held',
      hold_expires_at: at(-5),
      created_at: '2026-09-03T10:00:00+00:00',
      departure: { service_date: '2026-09-04', departure_time: '18:00:00' },
    }),
  ];
  const ids = (list: { id: string }[]) => list.map((item) => item.id);

  it('puts what is waiting first, the soonest to lapse on top, then by departure', () => {
    assert.deepEqual(ids(sortRides(rides, 'priority', NOW)), [
      'waiting-soon',
      'waiting-later',
      'lapsed',
      'confirmed',
    ]);
  });

  it('sorts by departure either way', () => {
    assert.deepEqual(ids(sortRides(rides, 'departure_soonest', NOW)), [
      'lapsed',
      'confirmed',
      'waiting-later',
      'waiting-soon',
    ]);
    assert.deepEqual(ids(sortRides(rides, 'departure_latest', NOW)), [
      'waiting-soon',
      'waiting-later',
      'confirmed',
      'lapsed',
    ]);
  });

  it('sorts by newest request', () => {
    assert.deepEqual(ids(sortRides(rides, 'requested', NOW)), [
      'waiting-later',
      'waiting-soon',
      'lapsed',
      'confirmed',
    ]);
  });

  it('leaves the list it was given alone', () => {
    const before = ids(rides);
    sortRides(rides, 'priority', NOW);
    assert.deepEqual(ids(rides), before);
  });
});

describe('holds', () => {
  it('treats a hold past its clock as expired, whatever its label', () => {
    const lapsed = { status: 'held' as const, hold_expires_at: at(-1) };
    assert.equal(isWaiting(lapsed, NOW), false);
    assert.equal(effectiveStatus(lapsed, NOW), 'expired');
    assert.equal(effectiveStatus({ status: 'held', hold_expires_at: at(1) }, NOW), 'held');
  });
});

describe('statusClause', () => {
  it('splits holds by their clock', () => {
    assert.equal(
      statusClause('waiting', NOW),
      'and(status.eq.held,hold_expires_at.gt."2026-09-03T12:00:00.000Z")',
    );
    assert.equal(
      statusClause('declined', NOW),
      'status.in.(declined,expired),and(status.eq.held,hold_expires_at.lte."2026-09-03T12:00:00.000Z")',
    );
  });

  it('lists the statuses of a plain group', () => {
    assert.equal(statusClause('finished', NOW), 'status.in.(completed,settled)');
  });
});

describe('listHref', () => {
  const defaults: ListParams = { status: null, from: null, to: null, sort: 'priority', page: 1 };

  it('keeps defaults out of the URL', () => {
    assert.equal(listHref('/my-rides', defaults, {}, 'priority'), '/my-rides');
    assert.equal(listHref('/my-rides', defaults, { page: 2 }, 'priority'), '/my-rides?page=2');
  });

  it('carries the filters and a chosen sort', () => {
    assert.equal(
      listHref('/my-rides', { ...defaults, status: 'waiting', from: '2026-09-01' }, { sort: 'requested' }, 'priority'),
      '/my-rides?status=waiting&from=2026-09-01&sort=requested',
    );
  });
});
