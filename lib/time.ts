/**
 * Time in Corridor is Ontario time.
 *
 * A departure is a `service_date` (date) plus a `departure_time` (time), both
 * America/Toronto wall clock. The absolute instant is *derived*, never stored:
 * Ontario observes DST, so a 05:00 departure is 05:00 local on both sides of
 * the change and its UTC offset differs.
 *
 * Postgres has `toronto_instant(date, time)` for the same job. This module is
 * its TypeScript counterpart, for display and for the rolling generation
 * window.
 */

export const TIMEZONE = 'America/Toronto';

/** "YYYY-MM-DD" */
export type ServiceDate = string;
/** "HH:MM" or "HH:MM:SS" as Postgres returns it. */
export type DepartureTime = string;

// hourCycle h23 rather than hour12:false — the latter reports midnight as
// hour 24 in some environments, which throws the offset out by a day.
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function torontoParts(instant: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

/** Offset of America/Toronto from UTC, in milliseconds, at a given instant. */
function torontoOffsetMs(instant: Date): number {
  const p = torontoParts(instant);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  // Intl drops sub-second precision, so compare against a whole second.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function splitTime(time: DepartureTime): { hour: number; minute: number; second: number } {
  const [h = '0', m = '0', s = '0'] = time.split(':');
  return { hour: Number(h), minute: Number(m), second: Number(s) };
}

/**
 * Local wall clock → absolute instant.
 *
 * Two passes: guess the instant as if the offset were UTC, read the real
 * offset there, correct, then confirm. The second pass matters only at the DST
 * boundary, where the first guess can land on the wrong side of the change.
 */
export function torontoInstant(date: ServiceDate, time: DepartureTime): Date {
  const [y = '1970', mo = '1', d = '1'] = date.split('-');
  const { hour, minute, second } = splitTime(time);
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, minute, second);

  let instant = new Date(naive - torontoOffsetMs(new Date(naive)));
  const corrected = new Date(naive - torontoOffsetMs(instant));
  if (corrected.getTime() !== instant.getTime()) instant = corrected;

  return instant;
}

/** Today's date in Ontario, as "YYYY-MM-DD". */
export function todayInToronto(now: Date = new Date()): ServiceDate {
  const p = torontoParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Calendar arithmetic on a service date. Never crosses into a Date object. */
export function addDays(date: ServiceDate, days: number): ServiceDate {
  const [y = '1970', m = '1', d = '1'] = date.split('-');
  const shifted = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days));
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(from: ServiceDate, to: ServiceDate): number {
  const at = (s: ServiceDate) => {
    const [y = '1970', m = '1', d = '1'] = s.split('-');
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** Day of week, 0 = Sunday, matching Postgres `extract(dow)` and `getDay()`. */
export function dayOfWeek(date: ServiceDate): number {
  const [y = '1970', m = '1', d = '1'] = date.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay();
}

export function isValidServiceDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y = '', m = '', d = ''] = date.split('-');
  const asDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return asDate.getUTCMonth() === Number(m) - 1 && asDate.getUTCDate() === Number(d);
}

/* -------------------------------------------------------------------------
 * Display
 * ---------------------------------------------------------------------- */

const timeFormatter = new Intl.DateTimeFormat('en-CA', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** "09:00:00" → "9:00 a.m." */
export function formatTime(time: DepartureTime): string {
  const { hour, minute } = splitTime(time);
  return timeFormatter.format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const longDateFormatter = new Intl.DateTimeFormat('en-CA', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function asUtcDate(date: ServiceDate): Date {
  const [y = '1970', m = '1', d = '1'] = date.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** "2026-09-03" → "Thu, Sep 3" */
export function formatServiceDate(date: ServiceDate): string {
  return dateFormatter.format(asUtcDate(date));
}

/** "2026-09-03" → "Thursday, September 3, 2026" */
export function formatServiceDateLong(date: ServiceDate): string {
  return longDateFormatter.format(asUtcDate(date));
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** An absolute instant, shown in Ontario time. */
export function formatInstant(instant: string | Date): string {
  return dateTimeFormatter.format(typeof instant === 'string' ? new Date(instant) : instant);
}

/** "in 42 minutes" / "3 minutes ago" — used for hold expiry countdowns. */
export function formatRelative(instant: string | Date, now: Date = new Date()): string {
  const target = typeof instant === 'string' ? new Date(instant) : instant;
  const diffMinutes = Math.round((target.getTime() - now.getTime()) / 60_000);

  const rtf = new Intl.RelativeTimeFormat('en-CA', { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  if (Math.abs(diffMinutes) < 60 * 24) return rtf.format(Math.round(diffMinutes / 60), 'hour');
  return rtf.format(Math.round(diffMinutes / (60 * 24)), 'day');
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** [1,2,3,4,5] → "Mon–Fri"; [0,6] → "Sat, Sun" */
export function formatDaysOfWeek(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  if (sorted.length === 0) return 'No days';

  const runs: number[][] = [];
  for (const day of sorted) {
    const last = runs.at(-1);
    if (last && day === last.at(-1)! + 1) last.push(day);
    else runs.push([day]);
  }

  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_NAMES[run[0]!]}–${DAY_NAMES[run.at(-1)!]}`
        : run.map((d) => DAY_NAMES[d]).join(', '),
    )
    .join(', ');
}
