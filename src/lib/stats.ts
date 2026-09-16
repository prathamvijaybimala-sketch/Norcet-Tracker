/**
 * Derived numbers for the UI (plan summary, "am I behind?", progress bars).
 * All pure helpers over (curriculum, planConfig, progress, schedule).
 */

import type { PlanConfig, ProgressStore, ScheduleDay, Subject } from '../types';
import { diffDays, todayISO } from './dates';
import type { LectureRef } from './parseCurriculum';

export type MissedLecture = { id: string; date: string };

/**
 * Lectures scheduled on past study days that are still unwatched, plus any
 * unwatched in-plan lecture the schedule no longer covers at all (the tail
 * that drops off when a day's hours are reduced on a plan with no off day -
 * `date` is empty for those). Shared by the Backlog tab and its nav badge.
 */
export function missedLectures(
  schedule: ScheduleDay[],
  lectureIndex: Map<string, LectureRef>,
  subjectOrder: string[],
  progress: ProgressStore,
  today: string,
): MissedLecture[] {
  const out: MissedLecture[] = [];
  const scheduled = new Set<string>();
  for (const d of schedule) {
    if (d.type !== 'study') continue;
    for (const id of d.lectureIds) {
      scheduled.add(id);
      if (d.date < today) out.push({ id, date: d.date });
    }
  }
  const included = new Set(subjectOrder);
  for (const [id, ref] of lectureIndex) {
    if (progress[id]?.lectureWatched) continue;
    if (!included.has(ref.subject.id)) continue;
    if (scheduled.has(id)) continue;
    out.push({ id, date: '' });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type PlanStats = {
  /** Last day that has lectures assigned. */
  finishDate: string | null;
  /** Last day of the plan including the final subject's buffer. */
  planEndDate: string | null;
  /** Calendar days spanned by the schedule. */
  totalDays: number;
  studyDays: number;
  bufferDays: number;
  weeks: number;
  remainingLectures: number;
  /** Effective (speed-adjusted) seconds still to watch. */
  remainingSec: number;
};

export function computePlanStats(schedule: ScheduleDay[]): PlanStats {
  let studyDays = 0;
  let bufferDays = 0;
  let finishDate: string | null = null;
  let remainingLectures = 0;
  for (const day of schedule) {
    if (day.type === 'study') {
      studyDays++;
      finishDate = day.date;
      remainingLectures += day.lectureIds.length;
    } else if (day.type === 'buffer') {
      bufferDays++;
    }
  }
  const planEndDate = schedule.length ? schedule[schedule.length - 1].date : null;
  return {
    finishDate,
    planEndDate,
    totalDays: schedule.length,
    studyDays,
    bufferDays,
    weeks: schedule.length ? Math.round((schedule.length / 7) * 10) / 10 : 0,
    remainingLectures,
    remainingSec: schedule.reduce((n, d) => n + d.plannedSec, 0),
  };
}

export type SubjectProgress = {
  subjectId: string;
  totalLectures: number;
  watched: number;
  notesDone: number;
  questionsDone: number;
  fullyDone: number;
  rawSec: number;
  watchedSec: number;
  remainingSec: number;
  effectiveRemainingSec: number;
};

export function subjectProgress(
  subject: Subject,
  progress: ProgressStore,
  playbackSpeed: number,
): SubjectProgress {
  const speed = playbackSpeed > 0 ? playbackSpeed : 1;
  let totalLectures = 0;
  let watched = 0;
  let notesDone = 0;
  let questionsDone = 0;
  let fullyDone = 0;
  let rawSec = 0;
  let watchedSec = 0;
  for (const topic of subject.topics) {
    for (const lecture of topic.lectures) {
      totalLectures++;
      rawSec += lecture.durationSec;
      const p = progress[lecture.id];
      if (p?.lectureWatched) {
        watched++;
        watchedSec += lecture.durationSec;
      }
      if (p?.notesDone) notesDone++;
      if (p?.questionsDone) questionsDone++;
      if (p?.lectureWatched && p?.notesDone && p?.questionsDone) fullyDone++;
    }
  }
  return {
    subjectId: subject.id,
    totalLectures,
    watched,
    notesDone,
    questionsDone,
    fullyDone,
    rawSec,
    watchedSec,
    remainingSec: rawSec - watchedSec,
    effectiveRemainingSec: (rawSec - watchedSec) / speed,
  };
}

export type TodayStats = {
  /** Lectures scheduled on study days *before* today that are still unwatched. */
  backlogLectures: number;
  backlogSec: number;
  /** Signed: positive = ahead of plan, negative = behind. */
  deltaDays: number;
  /** Effective seconds of lectures watched so far (planned subjects only). */
  actualSec: number;
  /** Effective seconds the plan expected to be done by end of yesterday. */
  expectedSec: number;
};

/**
 * "Days behind / ahead of schedule".
 *
 * expected = total remaining plan content x (fraction of the plan's study days
 * that have already elapsed); actual = effective seconds already watched.
 * The difference, expressed in days of `dailyHours`, is the indicator shown on
 * the Today view. This is deliberately separate from the backlog count: the
 * backlog says "these lectures were scheduled in the past and are not done",
 * while the delta says "overall, how far off pace are you".
 */
export function computeTodayStats(
  curriculum: Subject[],
  planConfig: PlanConfig,
  progress: ProgressStore,
  schedule: ScheduleDay[],
  today: string = todayISO(),
): TodayStats {
  const speed = planConfig.playbackSpeed > 0 ? planConfig.playbackSpeed : 1;
  const capacitySec = Math.max(1, Math.round(planConfig.dailyHours * 3600));

  let backlogLectures = 0;
  let backlogSec = 0;
  let elapsedStudyDays = 0;
  for (const day of schedule) {
    if (day.type !== 'study') continue;
    if (day.date < today) {
      elapsedStudyDays++;
      backlogLectures += day.lectureIds.length;
      backlogSec += day.plannedSec;
    }
  }

  const planSubjects = new Set(planConfig.subjectOrder);
  let totalEffSec = 0;
  let actualSec = 0;
  for (const subject of curriculum) {
    if (!planSubjects.has(subject.id)) continue;
    for (const topic of subject.topics) {
      for (const lecture of topic.lectures) {
        const eff = lecture.durationSec / speed;
        totalEffSec += eff;
        if (progress[lecture.id]?.lectureWatched) actualSec += eff;
      }
    }
  }

  const totalStudyDays = schedule.reduce((n, d) => (d.type === 'study' ? n + 1 : n), 0);
  const fraction = totalStudyDays > 0 ? elapsedStudyDays / totalStudyDays : 0;
  const expectedSec = totalEffSec * fraction;

  return {
    backlogLectures,
    backlogSec,
    deltaDays: (actualSec - expectedSec) / capacitySec,
    actualSec,
    expectedSec,
  };
}

export type DayCompletion = {
  total: number;
  watched: number;
  notes: number;
  questions: number;
  plannedSec: number;
  doneSec: number;
  allDone: boolean;
};

export function dayCompletion(
  day: ScheduleDay | undefined,
  progress: ProgressStore,
  index: Map<string, LectureRef>,
): DayCompletion {
  if (!day) {
    return { total: 0, watched: 0, notes: 0, questions: 0, plannedSec: 0, doneSec: 0, allDone: false };
  }
  let watched = 0;
  let notes = 0;
  let questions = 0;
  let plannedSec = 0;
  let doneSec = 0;
  for (const id of day.lectureIds) {
    const ref = index.get(id);
    if (!ref) continue;
    const sec = ref.lecture.durationSec;
    plannedSec += sec;
    const p = progress[id];
    if (p?.lectureWatched) {
      watched++;
      doneSec += sec;
    }
    if (p?.notesDone) notes++;
    if (p?.questionsDone) questions++;
  }
  return {
    total: day.lectureIds.length,
    watched,
    notes,
    questions,
    plannedSec,
    doneSec,
    allDone: day.lectureIds.length > 0 && watched === day.lectureIds.length,
  };
}

/**
 * Lectures marked watched on a given day (any subject).
 *
 * Used by the Today view to show what has already been done: because the
 * schedule only contains *unwatched* lectures, a row would otherwise vanish the
 * instant its box is ticked.
 */
export function completedOnDate(
  progress: ProgressStore,
  date: string,
  allowed?: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const [id, entry] of Object.entries(progress)) {
    if (entry.lectureWatched && entry.completedDate === date) {
      if (!allowed || allowed.has(id)) ids.push(id);
    }
  }
  return ids;
}

/** Status of a scheduled day, used by the timeline for colour-coding. */
export function dayStatus(
  day: ScheduleDay,
  progress: ProgressStore,
  today: string,
): 'done' | 'partial' | 'today' | 'upcoming' | 'missed' | 'buffer' | 'off' | 'leave' {
  if (day.isLeaveDay) return 'leave';
  if (day.type === 'buffer') return 'buffer';
  if (day.type === 'off') return 'off';
  let done = 0;
  for (const id of day.lectureIds) if (progress[id]?.lectureWatched) done++;
  if (day.lectureIds.length > 0 && done === day.lectureIds.length) return 'done';
  if (day.date < today) return 'missed';
  if (day.date === today) return 'today';
  return done > 0 ? 'partial' : 'upcoming';
}

/** Days from today until the plan's finish date (negative once past it). */
export function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null;
  return diffDays(today, date);
}

