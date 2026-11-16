/**
 * Month grids for the Timeline screen.
 *
 * Every month renders its OWN 7-column grid with its own Sun..Sat header row,
 * so every month needs its OWN leading blanks: the month's first visible day
 * must land in the column of its true weekday (Sunday = column 0). Without
 * per-month padding, day 1 of every non-first month falls under the Sunday
 * column and the whole month appears shifted by a few weekdays.
 *
 * The first month of the plan is usually partial (the plan starts mid-month);
 * the blanks for the missing early days keep the remaining days in their real
 * columns too.
 */

import { MONTH_NAMES, monthKey, parseISODate, weekdayOf } from './dates';
import type { ScheduleDay } from '../types';

export type MonthGrid = {
  /** 'YYYY-MM' */
  key: string;
  /** e.g. "September 2026" */
  label: string;
  /**
   * Cells for the 7-column grid, in row-major order. `null` = a leading blank
   * (before the month's first scheduled day); blanks only ever appear at the
   * start of the grid, never between two real days.
   */
  cells: (ScheduleDay | null)[];
};

type Bucket = MonthGrid & {
  /**
   * Leading blanks for THIS month's weekday alignment. A real day N of the
   * month sits at index `pad + N - 1`, so its column is
   * `(pad + N - 1) % 7` - equal to its true weekday by construction.
   */
  pad: number;
};

/**
 * Split a date-ordered schedule (every calendar day from start to end, no
 * gaps) into month grids, each padded so its days sit under the correct
 * weekday column.
 */
export function buildMonthGrid(schedule: ScheduleDay[]): MonthGrid[] {
  const out: Bucket[] = [];
  for (const day of schedule) {
    const key = monthKey(day.date);
    let bucket = out[out.length - 1];
    if (!bucket || bucket.key !== key) {
      const [y, m] = key.split('-').map(Number);
      const firstDow = weekdayOf(day.date); // 0 = Sunday .. 6 = Saturday
      const firstDom = parseISODate(day.date).getDate();
      // Blanks so `firstDom` lands in column `firstDow`:
      // index(firstDom) = pad + (firstDom - 1), and we need index % 7 === firstDow.
      const pad = (firstDow - (firstDom - 1) + 28) % 7;
      bucket = {
        key,
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        cells: Array.from({ length: pad + firstDom - 1 }, () => null),
        pad,
      };
      out.push(bucket);
    }
    const dayOfMonth = parseISODate(day.date).getDate();
    // Fill any gap up to this day (there are normally none - the schedule is
    // continuous - but a defensive fill keeps the invariant total).
    while (bucket.cells.length < bucket.pad + dayOfMonth - 1) bucket.cells.push(null);
    bucket.cells.push(day);
  }
  return out;
}
