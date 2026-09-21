import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lockoutMessage, retryAfterMinutes } from './lockout.ts';

/**
 * The policy half of the sign-in throttle. The counting itself needs a database
 * and is exercised by driving the real thing; what is worth pinning here is
 * the arithmetic a locked-out person actually reads, because "try again in 0
 * minutes" is how a lockout screen becomes a dead end.
 */

const NOW = new Date('2026-09-20T12:00:00Z');

describe('retryAfterMinutes', () => {
  it('counts from when the oldest attempt ages out, not from now', () => {
    // Twelve minutes into a fifteen-minute window: three left.
    const oldest = new Date(NOW.getTime() - 12 * 60_000).toISOString();
    assert.equal(retryAfterMinutes(oldest, NOW), 3);
  });

  it('never says zero, because zero reads as "try again" and they cannot', () => {
    const oldest = new Date(NOW.getTime() - 15 * 60_000).toISOString();
    assert.equal(retryAfterMinutes(oldest, NOW), 1);
  });

  it('rounds up, so the wait it promises is always long enough', () => {
    const oldest = new Date(NOW.getTime() - 12 * 60_000 - 30_000).toISOString();
    assert.equal(retryAfterMinutes(oldest, NOW), 3);
  });

  it('is zero when there is nothing on record', () => {
    assert.equal(retryAfterMinutes(null, NOW), 0);
  });

  it('gives the full window to an attempt made this instant', () => {
    assert.equal(retryAfterMinutes(NOW.toISOString(), NOW), 15);
  });
});

describe('lockoutMessage', () => {
  it('says what to do, not just what went wrong', () => {
    assert.match(lockoutMessage(4), /Try again in 4 minutes/);
    assert.match(lockoutMessage(4), /reset your password/);
  });

  it('reads like English at one minute', () => {
    assert.equal(lockoutMessage(1).includes('1 minutes'), false);
    assert.match(lockoutMessage(1), /in a minute/);
  });
});
