import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { centsToInput, formatCents, parseDollarsToCents } from './money.ts';

describe('parseDollarsToCents', () => {
  it('accepts whole dollars, one decimal, and two', () => {
    assert.equal(parseDollarsToCents('45'), 4500);
    assert.equal(parseDollarsToCents('45.5'), 4550);
    assert.equal(parseDollarsToCents('45.50'), 4550);
  });

  it('tolerates a dollar sign, commas, and surrounding space', () => {
    assert.equal(parseDollarsToCents(' $1,045.50 '), 104550);
  });

  it('avoids the float rounding trap', () => {
    // Math.round(19.99 * 100) is the classic way this goes wrong.
    assert.equal(parseDollarsToCents('19.99'), 1999);
    assert.equal(parseDollarsToCents('0.07'), 7);
  });

  it('rejects anything that is not a plain dollar amount', () => {
    for (const bad of ['', 'free', '45.999', '-45', '4 5', '.', '1e3']) {
      assert.equal(parseDollarsToCents(bad), null, bad);
    }
  });
});

describe('formatting', () => {
  it('formats cents as Canadian dollars', () => {
    assert.match(formatCents(4500), /45\.00/);
    assert.match(formatCents(0), /0\.00/);
  });

  it('round-trips through the input format', () => {
    assert.equal(parseDollarsToCents(centsToInput(104550)), 104550);
  });
});
