import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { voucherDiscountCents, voucherState, windowLabel } from './vouchers.ts';

const NOW = new Date('2026-09-20T12:00:00Z');

/**
 * This module is the display half of a rule the database owns. Every case here
 * is one `voucher_discount_cents()` answers too — if the two ever disagree, a
 * passenger is shown one total and charged another.
 */

describe('voucherDiscountCents', () => {
  it('takes a flat amount straight off', () => {
    assert.equal(voucherDiscountCents('amount', 500, 4500), 500);
  });

  it('takes a percentage of the whole fare', () => {
    assert.equal(voucherDiscountCents('percent', 10, 5500), 550);
  });

  it('floors a percentage rather than inventing a fraction of a cent', () => {
    // A third of $45.01 is 1500.333…
    assert.equal(voucherDiscountCents('percent', 33, 4501), 1485);
    assert.ok(Number.isInteger(voucherDiscountCents('percent', 33, 4501)));
  });

  it('never discounts past free', () => {
    assert.equal(voucherDiscountCents('amount', 10000, 4500), 4500);
    assert.equal(voucherDiscountCents('percent', 100, 4500), 4500);
  });

  it('returns nothing against a fare of nothing', () => {
    assert.equal(voucherDiscountCents('amount', 500, 0), 0);
  });
});

describe('voucherState', () => {
  const live = { is_active: true, expires_at: '2026-10-01T00:00:00Z', max_uses: 10 };

  it('is live while it is active, unexpired, and has uses left', () => {
    assert.equal(voucherState(live, 3, NOW), 'live');
  });

  it('is used up at the ceiling, not past it', () => {
    assert.equal(voucherState(live, 9, NOW), 'live');
    assert.equal(voucherState(live, 10, NOW), 'used up');
  });

  it('is expired once the instant has passed', () => {
    assert.equal(
      voucherState({ ...live, expires_at: '2026-09-19T00:00:00Z' }, 0, NOW),
      'expired',
    );
  });

  it('reads as withdrawn rather than expired, because that is the undoable one', () => {
    assert.equal(
      voucherState({ ...live, is_active: false, expires_at: '2026-09-19T00:00:00Z' }, 0, NOW),
      'withdrawn',
    );
  });
});

describe('windowLabel', () => {
  it('says what the operator picked', () => {
    assert.equal(windowLabel('3d'), '3 days');
    assert.equal(windowLabel('1m'), '1 month');
    assert.equal(windowLabel('4m'), '4 months');
  });
});
