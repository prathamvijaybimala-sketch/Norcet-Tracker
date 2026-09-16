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

export type Assigned = {
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

  const isNonStudyWeekday = (date: string): boolean => !studyDaySet.has(weekdayOf(date));

  /**
   * "Shift the schedule" catch-up (planConfig.backlogAnchor, set by the
   * Backlog feature): the FIRST genuine off day after the anchor — a
   * non-study weekday that is not a leave day, so usually the following
   * Sunday — is opened as one extra study day. It absorbs the week's
   * overflow lecture; after it, the plan continues on regular study days.
   */
  let overflowDate = '';
  if (planConfig.backlogAnchor && planConfig.backlogAnchor >= start) {
    let cursor = planConfig.backlogAnchor;
    for (let i = 0; i < 4000; i++) {
      cursor = addDays(cursor, 1);
      if (isNonStudyWeekday(cursor) && !leaveSet.has(cursor)) {
        overflowDate = cursor;
        break;
      }
    }
  }

  const isStudyDate = (date: string): boolean =>
    (studyDaySet.has(weekdayOf(date)) || date === overflowDate) && !leaveSet.has(date);

  /** Advance `date` until it is a valid study day. */
  const nextStudyDate = (date: string): string => {
    let cursor = date;
    // 4000 iterations ~ 10 years of safety margin.
    for (let i = 0; i < 4000 && !isStudyDate(cursor); i++) cursor = addDays(cursor, 1);
    return cursor;
  };

  const subjectById = new Map(curriculum.map((s) => [s.id, s]));

  /** lectureId -> its subject + lecture, for the backlog off-day feature. */
  const lectureSubject = new Map<string, { subject: Subject; lecture: Lecture }>();
  for (const subject of curriculum) {
    for (const topic of subject.topics) {
      for (const lecture of topic.lectures) {
        lectureSubject.set(lecture.id, { subject, lecture });
      }
    }
  }

  /**
   * Backlog "move to off day": lectures pulled OUT of the normal packing
   * queue and placed on the off day (usually Sunday) the user chose. A
   * lecture only lands there while it is still unwatched and still exists
   * in the curriculum; already-watched or removed entries are ignored.
   */
  const offDayByDate = new Map<string, string[]>();
  for (const [id, date] of Object.entries(planConfig.offDayLectures ?? {})) {
    if (!lectureSubject.has(id) || !isRemaining(progress, id) || date < start) continue;
    offDayByDate.set(date, [...(offDayByDate.get(date) ?? []), id]);
  }
  // Only lectures that actually land on a valid off day leave the queue.
  const offDayLectureSet = new Set<string>();
  for (const ids of offDayByDate.values()) for (const id of ids) offDayLectureSet.add(id);

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
        if (offDayLectureSet.has(lecture.id)) continue; // waiting on its off day
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

  // Place the backlog lectures that were moved to off days. If that off day
  // is also the shift-catch-up overflow day (rare), merge with the packed
  // lectures instead of overwriting them.
  for (const [date, ids] of offDayByDate) {
    const first = lectureSubject.get(ids[0]);
    if (!first) continue;
    const plannedSec = ids.reduce(
      (n, id) => n + Math.ceil((lectureSubject.get(id)?.lecture.durationSec ?? 0) / speed),
      0,
    );
    const existing = assigned.get(date);
    if (existing) {
      existing.lectureIds.push(...ids);
      existing.plannedSec += plannedSec;
    } else {
      mark(date, {
        type: 'study',
        subjectId: first.subject.id,
        subjectName: first.subject.name,
        lectureIds: [...ids],
        plannedSec,
      });
    }
  }

  // Per-day hours override (the Today screen's "Today: Xh" slider): a soft,
  // week-scoped rebalance layered on top of the packed plan. It runs AFTER the
  // backlog off-day placement so a reduced day's shortfall can ride onto an
  // off day that already carries moved lectures.
  if (planConfig.dayHours && Object.keys(planConfig.dayHours).length > 0) {
    const lectureEff = new Map<string, number>();
    for (const [id, { lecture }] of lectureSubject) {
      lectureEff.set(id, Math.ceil(lecture.durationSec / speed));
    }
    applyDayHourOverrides(
      assigned,
      planConfig,
      lectureEff,
      (id) => {
        const ref = lectureSubject.get(id);
        return ref ? { subjectId: ref.subject.id, subjectName: ref.subject.name } : null;
      },
      mark,
    );
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

/**
 * Per-day hours override (the Today screen's "Today: Xh" slider, section 7).
 *
 * One day's override is a SOFT, week-scoped adjustment layered on top of the
 * packed plan. It never changes `planConfig.dailyHours` and never shifts the
 * plan beyond its absorbing day, so next week always resumes normal pacing:
 *
 *  - DAY REDUCED (override < plan hours): the lectures that no longer fit on
 *    the day (its tail, whole lectures only - we never split a lecture) move
 *    onto that week's off day: the first off day on/after the reduced day,
 *    i.e. the same overflow day the Backlog feature uses. Every other day
 *    keeps exactly the lectures it already had - the rest of the plan stays
 *    put, the same way "To (off day)" does.
 *
 *  - DAY INCREASED (override > plan hours): the matching whole-lecture tail
 *    is pulled OFF the week's last study day (e.g. Saturday) and appended to
 *    the increased day. She is getting ahead, so the week's final day has
 *    less to do. The pull is capped at the last day's load (never negative),
 *    and if the increased day IS the last study day there is nothing left in
 *    the week to absorb the surplus, so the override is a no-op.
 *
 *  - No off day exists in the plan (studying 7 days a week): a reduction has
 *    nowhere to ride, so it is a no-op.
 *
 * Days that no longer exist in the assignment (fully watched, a leave day, a
 * buffer day) are skipped. Multiple overrides are applied in date order
 * against the evolving assignment, so two overrides in the same week compose
 * without double-moving a lecture.
 *
 * Mutates `assigned` (and calls `onMark` for a newly opened off day).
 */
export function applyDayHourOverrides(
  assigned: Map<string, Assigned>,
  planConfig: PlanConfig,
  lectureEff: Map<string, number>,
  subjectOf: (lectureId: string) => { subjectId: string; subjectName: string } | null,
  onMark: (date: string, day: Assigned) => void,
): void {
  const effOf = (id: string) => lectureEff.get(id) ?? 0;
  const loadOf = (ids: string[]) => ids.reduce((n, id) => n + effOf(id), 0);

  const entries = Object.entries(planConfig.dayHours).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [date, targetHours] of entries) {
    const day = assigned.get(date);
    if (!day || day.type !== 'study' || day.lectureIds.length === 0) continue;

    const targetSec = Math.round(targetHours * 3600);
    const loadSec = day.plannedSec;

    if (targetSec < loadSec) {
      // -------- reduced: the day's tail rides onto the week's off day --------
      const offDay = nextOffDayOnOrAfter(date, planConfig);
      if (!offDay) continue; // 7-day plan: no off day, nothing to absorb it
      const { keep, tail } = splitAtCapacity(day.lectureIds, targetSec, effOf);
      if (tail.length === 0) continue;
      day.lectureIds = keep;
      day.plannedSec = loadOf(keep);

      // Same merge behaviour as the backlog off-day placement: append when
      // the day already exists (a shift-opened overflow day, a buffer day),
      // otherwise open it as a study day.
      const existing = assigned.get(offDay);
      if (existing) {
        existing.lectureIds.push(...tail);
        existing.plannedSec += loadOf(tail);
      } else {
        const first = tail.map(subjectOf).find(Boolean);
        if (!first) continue;
        onMark(offDay, {
          type: 'study',
          subjectId: first.subjectId,
          subjectName: first.subjectName,
          lectureIds: [...tail],
          plannedSec: loadOf(tail),
        });
      }
    } else if (targetSec > loadSec) {
      // -------- increased: pull the week's last study day's tail here --------
      const weekStart = startOfWeek(date);
      let lastAfter: string | null = null;
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        if (d <= date) continue; // only days AFTER the increased day can give up load
        const hit = assigned.get(d);
        if (hit && hit.type === 'study' && hit.lectureIds.length > 0) lastAfter = d;
      }
      if (!lastAfter) continue; // the increased day is the week's last: no-op
      const lastDay = assigned.get(lastAfter)!;
      const pullSec = Math.min(targetSec - loadSec, lastDay.plannedSec);
      const { keep, tail } = splitTail(lastDay.lectureIds, pullSec, effOf);
      if (tail.length === 0) continue;
      lastDay.lectureIds = keep;
      lastDay.plannedSec = loadOf(keep);
      day.lectureIds = [...day.lectureIds, ...tail]; // chronological order kept
      day.plannedSec = loadOf(day.lectureIds);
    }
  }
}

/**
 * Split `ids` (chronological) into the longest prefix that fits `targetSec`
 * and the remaining tail. Mirrors the packer's convention: the first lecture
 * always stays, even if it overflows the target.
 */
function splitAtCapacity(
  ids: string[],
  targetSec: number,
  effOf: (id: string) => number,
): { keep: string[]; tail: string[] } {
  const keep: string[] = [];
  const tail: string[] = [];
  let used = 0;
  for (const id of ids) {
    if (keep.length > 0 && used + effOf(id) > targetSec) tail.push(id);
    else {
      keep.push(id);
      used += effOf(id);
    }
  }
  return { keep, tail };
}

/**
 * Cut whole lectures from the END of `ids` until at least `cutSec` of load is
 * removed; returns the remainder (keep) and the removed tail in chronological
 * order. The last lecture is always taken whole once the cut starts.
 */
function splitTail(
  ids: string[],
  cutSec: number,
  effOf: (id: string) => number,
): { keep: string[]; tail: string[] } {
  const keep = [...ids];
  const tail: string[] = [];
  let remaining = cutSec;
  while (remaining > 0 && keep.length > 0) {
    const id = keep.pop() as string;
    tail.push(id);
    remaining -= effOf(id);
  }
  tail.reverse();
  return { keep, tail };
}

/** Monday of the calendar week (Mon..Sun) containing `iso`. */
function startOfWeek(iso: string): string {
  const dow = weekdayOf(iso); // 0 = Sunday .. 6 = Saturday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
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
    // Same for per-day hours overrides - their week has passed.
    dayHours: Object.fromEntries(
      Object.entries(planConfig.dayHours ?? {}).filter(([d]) => d >= today),
    ),
    // Catching up IS a shift: the next off day (usually Sunday) may absorb
    // the week's overflow, matching what the Backlog tab promises.
    backlogAnchor: today,
  };
}

/**
 * First date on or after `date` that is a valid study day (weekday selected
 * AND not a leave day). Used to anchor "shift the schedule" on a day that can
 * actually take lectures.
 */
export function nextStudyDateOnOrAfter(date: string, planConfig: PlanConfig): string {
  const studyDaySet = new Set(planConfig.studyDays);
  const leaveSet = new Set(planConfig.leaveDates);
  let cursor = date;
  for (
    let i = 0;
    i < 4000 && !(studyDaySet.has(weekdayOf(cursor)) && !leaveSet.has(cursor));
    i++
  ) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/**
 * First date on or after `date` that is NOT a study day (a weekday the user
 * excluded, or a leave day). Usually the following Sunday - the "off day" the
 * Backlog tab offers for missed lectures. Returns null when no off day exists
 * within `maxDays` (e.g. a 7-days-a-week plan).
 */
export function nextOffDayOnOrAfter(
  date: string,
  planConfig: PlanConfig,
  maxDays = 60,
): string | null {
  const studyDaySet = new Set(planConfig.studyDays);
  const leaveSet = new Set(planConfig.leaveDates);
  let cursor = date;
  for (let i = 0; i <= maxDays; i++) {
    if (!studyDaySet.has(weekdayOf(cursor)) || leaveSet.has(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
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
