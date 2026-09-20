import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normaliseVoucherCode,
  VOUCHER_CODE_PATTERN,
  voucherDiscountCents,
  voucherState,
  windowLabel,
} from './vouchers.ts';

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

/**
 * This is the display half of a rule the database owns twice over: the same
 * folding happens in `normalise_voucher_code()`. If the two ever disagree, a
 * code the booking page accepts is a code the booking refuses.
 */
describe('normaliseVoucherCode', () => {
  it('uppercases, because a code is read aloud and typed in a hurry', () => {
    assert.equal(normaliseVoucherCode('ab12cd'), 'AB12CD');
  });

  it('trims whatever came with it', () => {
    assert.equal(normaliseVoucherCode('  AB12CD  '), 'AB12CD');
  });

  it('folds the letters that get misheard for digits', () => {
    // O against 0, and I or L against 1, are the pairs that go wrong down a
    // phone line. The alphabet drops the letters, so typing one is still
    // understood rather than refused.
    assert.equal(normaliseVoucherCode('OIL2AB'), '0112AB');
    assert.equal(normaliseVoucherCode('oil2ab'), '0112AB');
  });

  it('leaves a code drawn from the real alphabet alone', () => {
    for (const code of ['9K3MTV', '0112AB', 'ZZZZZZ', '234567']) {
      assert.equal(normaliseVoucherCode(code), code);
      assert.match(code, VOUCHER_CODE_PATTERN);
    }
  });

  it('does not rescue something that is not a code', () => {
    assert.doesNotMatch(normaliseVoucherCode('AB-12C'), VOUCHER_CODE_PATTERN);
    assert.doesNotMatch(normaliseVoucherCode('AB12C'), VOUCHER_CODE_PATTERN);
    assert.doesNotMatch(normaliseVoucherCode('AB12CDE'), VOUCHER_CODE_PATTERN);
  });

  it('still accepts the numeric codes issued before the alphabet widened', () => {
    assert.match(normaliseVoucherCode('048655'), VOUCHER_CODE_PATTERN);
  });
});

describe('windowLabel', () => {
  it('says what the operator picked', () => {
    assert.equal(windowLabel('3d'), '3 days');
    assert.equal(windowLabel('1m'), '1 month');
    assert.equal(windowLabel('4m'), '4 months');
  });
});
