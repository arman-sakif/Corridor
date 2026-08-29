import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addDays, dayOfWeek, daysBetween, formatDaysOfWeek, torontoInstant } from './time.ts';

describe('torontoInstant', () => {
  it('resolves a summer wall clock at EDT (UTC-4)', () => {
    assert.equal(torontoInstant('2026-07-15', '09:00:00').toISOString(), '2026-07-15T13:00:00.000Z');
  });

  it('resolves a winter wall clock at EST (UTC-5)', () => {
    assert.equal(torontoInstant('2026-01-15', '09:00:00').toISOString(), '2026-01-15T14:00:00.000Z');
  });

  it('keeps a 05:00 departure at 05:00 local on both sides of the DST change', () => {
    // Spring forward 2026: Sunday March 8.
    const before = torontoInstant('2026-03-07', '05:00:00');
    const after = torontoInstant('2026-03-09', '05:00:00');
    assert.equal(before.toISOString(), '2026-03-07T10:00:00.000Z'); // EST
    assert.equal(after.toISOString(), '2026-03-09T09:00:00.000Z'); // EDT
  });

  it('handles the fall-back overlap without landing on the wrong day', () => {
    // Fall back 2026: Sunday November 1.
    assert.equal(torontoInstant('2026-11-01', '01:30:00').toISOString(), '2026-11-01T05:30:00.000Z');
  });

  it('handles midnight, where a 24-hour clock is easiest to get wrong', () => {
    assert.equal(torontoInstant('2026-07-15', '00:00:00').toISOString(), '2026-07-15T04:00:00.000Z');
  });
});

describe('service date arithmetic', () => {
  it('adds days across a month boundary', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('adds days across the DST boundary without slipping', () => {
    assert.equal(addDays('2026-03-07', 2), '2026-03-09');
  });

  it('counts days between dates', () => {
    assert.equal(daysBetween('2026-09-01', '2026-10-01'), 30);
    assert.equal(daysBetween('2026-09-01', '2026-09-01'), 0);
  });

  it('reports day of week with Sunday as 0, matching Postgres and JS', () => {
    assert.equal(dayOfWeek('2026-08-30'), 0); // Sunday
    assert.equal(dayOfWeek('2026-09-03'), 4); // Thursday
  });
});

describe('formatDaysOfWeek', () => {
  it('collapses a run into a range', () => {
    assert.equal(formatDaysOfWeek([1, 2, 3, 4, 5]), 'Mon–Fri');
  });

  it('lists short runs individually', () => {
    assert.equal(formatDaysOfWeek([0, 6]), 'Sun, Sat');
  });

  it('names the everyday case outright', () => {
    assert.equal(formatDaysOfWeek([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  });
});
