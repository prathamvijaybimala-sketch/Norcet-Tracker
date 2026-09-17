import type { ProgressStore, ScheduleDay } from '../types';
import { addDays } from './dates';

/**
 * The study streak.
 *
 * A day COUNTS when at least one lecture was watched IN the app on that
 * date (its progress entry carries `completedDate`). Lectures marked
 * "done before using the app" (preDone) have no completedDate and never
 * count: they were not watched in the app.
 *
 * Off days, buffer (rest) days, leave days and any other unplanned day
 * neither count NOR break the streak - they are simply skipped, so the
 * streak rides through her Sundays and rest days untouched.
 *
 * A planned STUDY day with zero watched lectures ends the streak.
 * The walk stops at the plan's first scheduled day (before that, there was
 * no plan to follow).
 */
export function computeStreak(progress: ProgressStore, schedule: ScheduleDay[], today: string): number {
  if (schedule.length === 0) return 0;
  const start = schedule[0].date;
  if (today < start) return 0;

  // Study days that actually carry lectures.
  const planned = new Set<string>();
  for (const d of schedule) {
    if (d.type === 'study' && d.lectureIds.length > 0) planned.add(d.date);
  }

  // How many in-app watches landed on each date.
  const watchedByDate = new Map<string, number>();
  for (const p of Object.values(progress)) {
    if (p.completedDate) {
      watchedByDate.set(p.completedDate, (watchedByDate.get(p.completedDate) ?? 0) + 1);
    }
  }

  let days = 0;
  let cursor = today;
  let guard = 0;
  while (cursor >= start && guard++ < 3660) {
    if (planned.has(cursor)) {
      if ((watchedByDate.get(cursor) ?? 0) > 0) days++;
      else break;
    }
    cursor = addDays(cursor, -1);
  }
  return days;
}
