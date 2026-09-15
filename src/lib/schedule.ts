/**
 * The scheduling engine (section 5 of the spec).
 *
 * `generateSchedule` is a PURE function: (curriculum, planConfig, progress) ->
 * ScheduleDay[]. The output is never persisted - it is recomputed on every
 * state change (checkbox tick, leave day, reorder, buffer edit), which is what
 * makes out-of-order completion, leave days and settings changes "just work"
 * with no manual patching of a stored plan.
 *
 * Cost: one pass over the lectures (O(n)) plus one pass over the resulting
 * calendar days. ~1000 lectures is a fraction of a millisecond.
 */

import type { Lecture, PlanConfig, ProgressStore, ScheduleDay, Subject } from '../types';
import { addDays, diffDays, weekdayOf } from './dates';
import type { LectureRef } from './parseCurriculum';

/** A lecture only counts as "not yet done" if it has not been watched. */
function isRemaining(progress: ProgressStore, id: string): boolean {
  return progress[id]?.lectureWatched !== true;
}

export type ScheduleInputs = {
  curriculum: Subject[];
  planConfig: PlanConfig;
  progress: ProgressStore;
};

type Assigned = {
  type: 'study' | 'buffer';
  subjectId: string;
  subjectName: string;
  lectureIds: string[];
  plannedSec: number;
};

/**
 * Compute the full day-by-day plan.
 *
 * Packing rules (section 5.1):
 *  - day capacity       = dailyHours * 3600 seconds
 *  - lecture cost       = durationSec / playbackSpeed  (effective seconds)
 *  - lectures are added greedily while they fit; a lecture that does not fit in
 *    the *remaining* capacity of the current day is carried WHOLE to the next
 *    study day. We never split a lecture across two days, so some days end up
 *    under-filled by design (most visibly at subject boundaries, since a new
 *    subject always starts on a fresh day).
 *  - if a single lecture is longer than a whole day's capacity it is placed
 *    alone on that day and the day simply overflows (the only way to avoid an
 *    infinite loop; documented rather than hidden).
 *  - non-study weekdays and leave dates get zero lectures and are emitted as
 *    `type: "off"` so the timeline can show them.
 */
export function generateSchedule(
  curriculum: Subject[],
  planConfig: PlanConfig,
  progress: ProgressStore,
): ScheduleDay[] {
  const speed = planConfig.playbackSpeed > 0 ? planConfig.playbackSpeed : 1;
  const dailyHours = planConfig.dailyHours;
  const capacitySec = Math.round(dailyHours * 3600);

  // Degenerate configs: nothing could ever be scheduled. Bail out rather than
  // spin forever.
  if (capacitySec <= 0 || planConfig.studyDays.length === 0 || curriculum.length === 0) {
    return [];
  }

  const start = planConfig.startDate;
  const leaveSet = new Set(planConfig.leaveDates);
  const studyDaySet = new Set(planConfig.studyDays);

  const isStudyDate = (date: string): boolean =>
    studyDaySet.has(weekdayOf(date)) && !leaveSet.has(date);

  /** Advance `date` until it is a valid study day. */
  const nextStudyDate = (date: string): string => {
    let cursor = date;
    // 4000 iterations ~ 10 years of safety margin.
    for (let i = 0; i < 4000 && !isStudyDate(cursor); i++) cursor = addDays(cursor, 1);
    return cursor;
  };

  const subjectById = new Map(curriculum.map((s) => [s.id, s]));

  const assigned = new Map<string, Assigned>();
  let cursor = start;
  let lastDate = '';

  const mark = (date: string, day: Assigned) => {
    assigned.set(date, day);
    if (!lastDate || date > lastDate) lastDate = date;
  };

  for (const subjectId of planConfig.subjectOrder) {
    const subject = subjectById.get(subjectId);
    if (!subject) continue;

    const remaining: { lecture: Lecture; eff: number }[] = [];
    for (const topic of subject.topics) {
      for (const lecture of topic.lectures) {
        if (!isRemaining(progress, lecture.id)) continue;
        remaining.push({ lecture, eff: Math.ceil(lecture.durationSec / speed) });
      }
    }
    // A fully completed subject contributes zero days AND zero buffer days:
    // there is nothing left to buffer after.
    if (remaining.length === 0) continue;

    let i = 0;
    while (i < remaining.length) {
      cursor = nextStudyDate(cursor);
      const lectureIds: string[] = [];
      let used = 0;
      while (i < remaining.length) {
        const next = remaining[i];
        if (lectureIds.length > 0 && used + next.eff > capacitySec) break; // carry whole
        lectureIds.push(next.lecture.id);
        used += next.eff;
        i++;
        if (used >= capacitySec) break;
      }
      mark(cursor, {
        type: 'study',
        subjectId,
        subjectName: subject.name,
        lectureIds,
        plannedSec: used,
      });
      cursor = addDays(cursor, 1);
    }

    // Buffer days after the last lecture day of this subject.
    const bufferDays = Math.max(0, Math.round(planConfig.bufferDaysBySubject[subjectId] ?? 0));
    for (let b = 0; b < bufferDays; b++) {
      if (!planConfig.bufferCountsOffDays) {
        // Alternative mode: only otherwise-valid study days count towards the
        // buffer, so a buffer spanning a weekend consumes more calendar time.
        cursor = nextStudyDate(cursor);
      }
      mark(cursor, {
        type: 'buffer',
        subjectId,
        subjectName: subject.name,
        lectureIds: [],
        plannedSec: 0,
      });
      cursor = addDays(cursor, 1);
    }
  }

  if (assigned.size === 0) return [];

  // Emit every calendar day from start to the last assigned day, filling the
  // gaps with `off` days.
  const totalDays = diffDays(start, lastDate) + 1;
  const days: ScheduleDay[] = [];
  let date = start;
  for (let d = 0; d < totalDays; d++) {
    const hit = assigned.get(date);
    const isLeaveDay = leaveSet.has(date);
    const isNonStudyWeekday = !studyDaySet.has(weekdayOf(date));
    if (hit) {
      days.push({
        date,
        type: hit.type,
        subjectId: hit.subjectId,
        subjectName: hit.subjectName,
        lectureIds: hit.lectureIds,
        plannedSec: hit.plannedSec,
        isLeaveDay,
        isNonStudyWeekday,
      });
    } else {
      days.push({
        date,
        type: 'off',
        lectureIds: [],
        plannedSec: 0,
        isLeaveDay,
        isNonStudyWeekday,
      });
    }
    date = addDays(date, 1);
  }

  return days;
}

/** date -> ScheduleDay, for O(1) lookups in the UI. */
export function indexScheduleByDate(schedule: ScheduleDay[]): Map<string, ScheduleDay> {
  const map = new Map<string, ScheduleDay>();
  for (const day of schedule) map.set(day.date, day);
  return map;
}

/** lectureId -> scheduled date. */
export function indexScheduleByLecture(schedule: ScheduleDay[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const day of schedule) {
    for (const id of day.lectureIds) map.set(id, day.date);
  }
  return map;
}

/**
 * "Catch me up" (section 5.3).
 *
 * Deliberately an EXPLICIT user action - silently reflowing a study plan is
 * worse than showing a backlog. Because the schedule is always regenerated from
 * "remaining, unwatched lectures", moving the start date forward to today is
 * exactly equivalent to re-planning every remaining lecture (past-due ones
 * included) from today onwards: they were never removed from the pool, they
 * were simply generated in the past.
 */
export function catchUpPlan(planConfig: PlanConfig, today: string): PlanConfig {
  if (diffDays(planConfig.startDate, today) <= 0) return planConfig;
  return {
    ...planConfig,
    startDate: today,
    // Leave days in the past can no longer shift anything; keep the list tidy.
    leaveDates: planConfig.leaveDates.filter((d) => d >= today),
  };
}

/**
 * Small LRU-ish memo cache.
 *
 * Keyed by a cheap version signature (see store/versionSignature) rather than a
 * deep-equality check on every render. Holds a handful of entries so that, e.g.,
 * a setup-screen preview with modified settings does not thrash the main cache.
 */
export function createScheduleCache(limit = 8) {
  const cache = new Map<string, ScheduleDay[]>();
  return function getSchedule(
    key: string,
    curriculum: Subject[],
    planConfig: PlanConfig,
    progress: ProgressStore,
  ): ScheduleDay[] {
    const hit = cache.get(key);
    if (hit) return hit;
    const value = generateSchedule(curriculum, planConfig, progress);
    cache.set(key, value);
    if (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  };
}

/** Last day that actually has lectures assigned (ignoring trailing buffer days). */
export function lastStudyDate(schedule: ScheduleDay[]): string | null {
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (schedule[i].type === 'study') return schedule[i].date;
  }
  return null;
}

export function countStudyDays(schedule: ScheduleDay[]): number {
  let n = 0;
  for (const day of schedule) if (day.type === 'study') n++;
  return n;
}

/** Flattened, ordered lectures of a subject (topic order, then lecture order). */
export function flattenSubject(subject: Subject): LectureRef[] {
  const out: LectureRef[] = [];
  const subjectLectureCount = subject.topics.reduce((n, t) => n + t.lectures.length, 0);
  for (const topic of subject.topics) {
    for (const lecture of topic.lectures) {
      out.push({ lecture, topic, subject, indexInSubject: out.length, subjectLectureCount });
    }
  }
  return out;
}
