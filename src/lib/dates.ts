/**
 * Local-timezone date helpers.
 *
 * Everything in this app is day-granular, so dates are stored and passed around
 * as `YYYY-MM-DD` strings with no time component. To avoid the classic
 * `new Date('2026-09-15')` UTC-parsing bug (which shifts the day for anyone
 * west of Greenwich), all parsing/formatting here goes through local getters.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-midnight `Date` for a `YYYY-MM-DD` string. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

/** `Date` -> `YYYY-MM-DD` using *local* calendar fields. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = parseISODate(value);
  return !Number.isNaN(d.getTime()) && toISODate(d) === value;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

/** 1-based day of the year (for rotating quotes / greetings). */
export function dayOfYear(now: Date = new Date()): number {
  const start = new Date(now.getFullYear(), 0, 0).getTime();
  return Math.floor((now.getTime() - start) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  const a = parseISODate(from).getTime();
  const b = parseISODate(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** 0 = Sunday .. 6 = Saturday, in local time. */
export function weekdayOf(iso: string): number {
  return parseISODate(iso).getDay();
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `formatDate('2026-09-15') -> "Tue 15 Sep"` */
export function formatDate(iso: string, withWeekday = true): string {
  const d = parseISODate(iso);
  const base = `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
  return withWeekday ? `${WEEKDAY_LABELS[d.getDay()]} ${base}` : base;
}

/** `formatDateLong('2026-09-15') -> "15 September 2026"` */
export function formatDateLong(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** All `YYYY-MM-DD` dates from `start` to `end` inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  // Invalid input (e.g. a cleared date field yields "") would otherwise loop
  // to the safety cap below and return thousands of NaN-dates.
  if (!isISODate(start) || !isISODate(end)) return out;
  if (diffDays(start, end) < 0) return out;
  let cursor = start;
  // Guard against pathological input; a 20 year plan is still only ~7300 days.
  for (let i = 0; i < 20_000; i++) {
    out.push(cursor);
    if (cursor === end) break;
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function minISO(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxISO(a: string, b: string): string {
  return a >= b ? a : b;
}
