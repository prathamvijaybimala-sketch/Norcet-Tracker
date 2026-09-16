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
 * An override is a SOFT, week-scoped adjustment layered on top of the packed
 * plan. It never changes `planConfig.dailyHours`, and the week's lecture pool
 * is the lectures the base plan already assigned to that week - so NEXT WEEK
 * always resumes normal pacing, exactly as before.
 *
 * When a week has one or more overrides, the WHOLE WEEK IS RE-PACKED from
 * scratch (that week's study days, in date order, from the week's lecture
 * pool):
 *
 *  - each day takes the next lectures that fit its own capacity (override
 *    hours when overridden, plan hours otherwise); a lecture that does not
 *    fit is carried WHOLE to the next day, and a day never mixes subjects
 *    (a new subject always starts on a fresh day, as in the main packer);
 *  - DAY REDUCED: the week can no longer hold its pool, so the remaining tail
 *    rides onto the week's off day - the first off/leave day on/after the
 *    week's last study day, i.e. the same overflow day the Backlog feature
 *    uses. If the plan has NO off day (studying 7 days a week), the tail is
 *    simply dropped: it stays unwatched and unscheduled, and the Backlog tab
 *    lists it as missed (restoring the day's hours puts it straight back).
 *  - DAY INCREASED: the week holds more than its pool, so the later days
 *    (typically the week's last study day) get lighter or empty out - capped
 *    at zero, never negative, nothing pulled from next week. If the
 *    increased day is already the week's last study day the week's pool
 *    simply fills the days as before: a natural no-op.
 *
 * Lectures deliberately parked on an off day via Backlog ("To (off day)")
 * keep their spot and are excluded from the reflowed pool. Weeks without
 * overrides are left exactly as the base plan packed them, so multiple
 * overrides in different weeks compose independently, and two overrides in
 * the same week are handled by one re-pack.
 *
 * Days that are not study days in the base assignment (fully watched, a
 * leave day, a buffer day) carry no override.
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

  // Snapshot the assignment BEFORE any override is applied: each affected
  // week re-packs itself from its own base state, so overrides in different
  // weeks never interfere and multiple overrides in one week re-pack once.
  const base = new Map<string, Assigned>();
  for (const [date, day] of assigned) {
    base.set(date, { ...day, lectureIds: [...day.lectureIds] });
  }

  // The weeks that carry at least one override on a real study day.
  const weeks = new Set<string>();
  for (const date of Object.keys(planConfig.dayHours)) {
    const day = base.get(date);
    if (day && day.type === 'study') weeks.add(startOfWeek(date));
  }

  const parked = new Set(Object.keys(planConfig.offDayLectures ?? {}));

  for (const weekStart of [...weeks].sort()) {
    // The week's study days, in date order (exactly the days the base plan
    // assigned to this week - a day that was already empty stays empty).
    // A day that holds ONLY parked backlog lectures is left alone: it keeps
    // its parked lectures exactly where she parked them.
    const weekDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const hit = base.get(d);
      if (
        hit &&
        hit.type === 'study' &&
        hit.lectureIds.some((id) => !parked.has(id))
      ) {
        weekDays.push(d);
      }
    }
    if (weekDays.length === 0) continue;

    // The main packer places each subject on consecutive days, so the week's
    // study days group into runs, one per subject (in order).
    const runs: { subjectId: string; days: string[] }[] = [];
    for (const d of weekDays) {
      const sid = base.get(d)!.subjectId;
      if (runs.length > 0 && runs[runs.length - 1].subjectId === sid) {
        runs[runs.length - 1].days.push(d);
      } else {
        runs.push({ subjectId: sid, days: [d] });
      }
    }

    // The week's lecture pool as blocks, in the SAME order as the runs: the
    // base plan's lectures for each run's days, minus anything deliberately
    // parked on an off day (parked lectures keep their spot).
    const blocks = runs.map((run) =>
      run.days.flatMap((d) => base.get(d)!.lectureIds).filter((id) => !parked.has(id)),
    );

    // The week's off day: the first off/leave day on/after the week's last
    // study day - the same overflow day the Backlog feature uses.
    const absorber = nextOffDayOnOrAfter(weekDays[weekDays.length - 1], planConfig);
    const flush = (ids: string[]) => {
      if (!absorber || ids.length === 0) return;
      const existing = assigned.get(absorber);
      if (existing) {
        existing.lectureIds.push(...ids);
        existing.plannedSec += loadOf(ids);
      } else {
        const first = ids.map(subjectOf).find(Boolean);
        if (first) {
          onMark(absorber, {
            type: 'study',
            subjectId: first.subjectId,
            subjectName: first.subjectName,
            lectureIds: ids,
            plannedSec: loadOf(ids),
          });
        }
      }
    };

    // Re-pack each subject's run across its days, with each day's own
    // (possibly overridden) capacity.
    runs.forEach((run, j) => {
      const block = blocks[j];
      let cursor = 0;
      for (const d of run.days) {
        const hours = planConfig.dayHours[d] ?? planConfig.dailyHours;
        const capSec = Math.round(hours * 3600);
        const ids: string[] = [];
        let used = 0;
        while (cursor < block.length) {
          const id = block[cursor];
          const cost = effOf(id);
          if (ids.length > 0 && used + cost > capSec) break; // carry whole
          ids.push(id);
          used += cost;
          cursor++;
          if (used >= capSec) break;
        }

        if (ids.length === 0) {
          // Capped at zero: the day empties out and drops from the plan.
          if (assigned.has(d)) assigned.delete(d);
        } else {
          const existing = assigned.get(d);
          if (existing) {
            existing.lectureIds = ids;
            existing.plannedSec = used;
          } else {
            const first = subjectOf(ids[0]);
            if (first) {
              onMark(d, {
                type: 'study',
                subjectId: first.subjectId,
                subjectName: first.subjectName,
                lectureIds: ids,
                plannedSec: used,
              });
            }
          }
        }
      }
      // Lectures this subject's run could no longer hold (a reduced day)
      // ride onto the week's off day. With no off day (7-days-a-week plan)
      // they are dropped on purpose: unwatched and unscheduled, listed as
      // missed in the Backlog tab; restoring the hours puts them back.
      if (cursor < block.length) flush(block.slice(cursor));
    });
  }
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
