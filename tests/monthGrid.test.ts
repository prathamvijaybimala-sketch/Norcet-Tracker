/**
 * Pure tests for the Timeline month grids: every month must render its days
 * under the correct weekday column (the grid's header row is Sun..Sat).
 *
 * This guards the regression where only the FIRST month got leading padding,
 * so day 1 of every later month fell under the Sunday column (e.g. Thursday
 * 1 October 2026 rendered as a Sunday).
 */
import { describe, expect, it } from 'vitest';
import { buildMonthGrid } from '../src/lib/monthGrid';
import { dateRange, weekdayOf } from '../src/lib/dates';
import type { ScheduleDay } from '../src/types';

const day = (date: string): ScheduleDay => ({
  date,
  type: 'study',
  subjectId: 's1',
  subjectName: 'S',
  lectureIds: [],
  plannedSec: 0,
  isLeaveDay: false,
  isNonStudyWeekday: false,
});

// Continuous plan starting mid-month (like the demo) and crossing the year
// turn: partial first month + several full months.
const schedule = dateRange('2026-09-15', '2027-03-16').map(day);
const months = buildMonthGrid(schedule);

describe('buildMonthGrid', () => {
  it('splits the schedule into chronological month buckets', () => {
    expect(months.map((m) => m.key)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    expect(months[0].label).toBe('September 2026');
    expect(months[1].label).toBe('October 2026');
  });

  it('lands every month\'s first day under its true weekday', () => {
    for (const m of months) {
      const idx = m.cells.findIndex((c) => c !== null);
      expect(idx, `first cell of ${m.key}`).toBeGreaterThanOrEqual(0);
      expect(idx % 7, `${m.cells[idx]!.date} in ${m.key}`).toBe(weekdayOf(m.cells[idx]!.date));
    }
  });

  it('keeps EVERY scheduled day in its weekday column (Sun = column 0)', () => {
    let checked = 0;
    for (const m of months) {
      m.cells.forEach((c, i) => {
        if (!c) return;
        expect(i % 7, `${c.date} in ${m.key}`).toBe(weekdayOf(c.date));
        checked++;
      });
    }
    expect(checked).toBe(schedule.length);
  });

  it('puts Thursday 1 October 2026 in the Thursday column (index 4)', () => {
    expect(weekdayOf('2026-10-01')).toBe(4); // sanity: Oct 1 2026 is a Thursday
    const oct = months.find((m) => m.key === '2026-10')!;
    expect(oct.cells[4]?.date).toBe('2026-10-01');
  });

  it('keeps the partial first month aligned too (plan starts Tue 15 Sep 2026)', () => {
    const sep = months[0];
    const idx = sep.cells.findIndex((c) => c?.date === '2026-09-15');
    // 2 leading blanks (before the week starts on Sunday) + 14 days of
    // 1-14 Sep -> index 16, which is column 2 = Tuesday.
    expect(idx).toBe(16);
    expect(idx % 7).toBe(2);
  });

  it('uses blanks only as leading padding, never between two real days', () => {
    for (const m of months) {
      const firstDay = m.cells.findIndex((c) => c !== null);
      for (let i = firstDay; i < m.cells.length; i++) {
        expect(m.cells[i], `cell ${i} of ${m.key}`).not.toBeNull();
      }
    }
  });

  it('renders a full month as 42 cells of day slots (31-day month, no blanks)', () => {
    const oct = months.find((m) => m.key === '2026-10')!;
    // 4 leading blanks + 31 days = 35 cells; November (starts Sunday) needs none.
    expect(oct.cells).toHaveLength(35);
    const nov = months.find((m) => m.key === '2026-11')!;
    expect(nov.cells).toHaveLength(30);
    expect(nov.cells[0]?.date).toBe('2026-11-01');
  });
});
