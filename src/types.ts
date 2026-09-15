/**
 * Core domain types.
 *
 * The single most important architectural decision in this app is that three
 * very different kinds of state are kept separate:
 *
 *   1. Curriculum  - derived from the imported JSON, effectively read-only.
 *   2. PlanConfig  - the user's pacing / ordering choices (small, editable).
 *   3. Progress    - the source of truth (what has actually been done).
 *
 * The day-by-day schedule is NEVER persisted: it is always recomputed by
 * `generateSchedule(curriculum, planConfig, progress)`. See lib/schedule.ts.
 */

/** ---------- 2.1 Curriculum (derived from import) ---------- */

export type Lecture = {
  id: string; // generated at import time, stable across re-imports (see lib/id.ts)
  name: string;
  durationSec: number; // raw wall-clock seconds at 1x speed
};

export type Topic = {
  id: string;
  name: string;
  lectures: Lecture[];
};

export type Subject = {
  id: string;
  name: string;
  instructor: string;
  topics: Topic[];
};

/** ---------- 2.2 PlanConfig (user's pacing / ordering choices) ---------- */

export type PlanConfig = {
  /** Subject ids in the order they should be studied. Excluded subjects are absent. */
  subjectOrder: string[];
  /** Hours of raw study per study day, e.g. 3. */
  dailyHours: number;
  /** Which weekdays are study days: 0 = Sunday .. 6 = Saturday. */
  studyDays: number[];
  /** Video playback speed, e.g. 1.5 -> a 60 min lecture takes 40 min. */
  playbackSpeed: number;
  /** subjectId -> number of buffer days to insert after finishing that subject. */
  bufferDaysBySubject: Record<string, number>;
  /** Ad-hoc days off, ISO `YYYY-MM-DD`. */
  leaveDates: string[];
  /** ISO `YYYY-MM-DD`. Editable to push the whole plan; also used by "Catch me up". */
  startDate: string;

  /**
   * How buffer days consume calendar time (see section 5.4 of the spec, which
   * explicitly leaves this choice open and asks for a documented default).
   *
   *  - `true`  (DEFAULT): a buffer of N means N *calendar* days, counting
   *    through weekends / leave days / non-study weekdays. Rationale: buffer
   *    days are rest & catch-up time, not lecture time, so a Sunday spent
   *    catching up still is a Sunday that passes.
   *  - `false`: buffer counts only days that are otherwise valid study days,
   *    i.e. a buffer of N means "skip N lecture days" (so a buffer spanning a
   *    weekend consumes more calendar time).
   */
  bufferCountsOffDays: boolean;

  /**
   * Revision intervals in days (see section 6). Kept on PlanConfig so that it
   * travels inside the standard export/import payload.
   */
  revisionIntervals: number[];

  /** Student's name, used in the greeting box. Empty = no name shown. */
  studentName: string;

  /**
   * Missed lectures explicitly moved to an off day (Backlog feature):
   * lectureId -> ISO `YYYY-MM-DD` of the off day (usually Sunday) on which the
   * lecture will be watched. Such lectures leave the normal packing queue and
   * are scheduled on the given off day, which then renders as a study day.
   */
  offDayLectures: Record<string, string>;

  /**
   * When set, this date is the anchor of a "shift the schedule" catch-up
   * (Backlog feature): the plan is re-spread from it, and the FIRST off day
   * after the anchor (usually the following Sunday) is opened as an extra
   * study day that absorbs the week's overflow lecture. Stays fixed until the
   * user shifts / catches up again.
   */
  backlogAnchor: string | null;
};

/** ---------- 2.3 Progress (the source of truth) ---------- */

export type LectureProgress = {
  lectureId: string;
  lectureWatched: boolean;
  notesDone: boolean;
  questionsDone: boolean;
  /** ISO `YYYY-MM-DD`, set when `lectureWatched` flips to true, cleared if unchecked. */
  completedDate: string | null;
};

export type ProgressStore = Record<string, LectureProgress>;

/** ---------- 2.4 RevisionQueue (separate from the main schedule) ---------- */

export type RevisionResult = 'done' | 'skipped';

export type RevisionItem = {
  lectureId: string;
  /** Index into PlanConfig.revisionIntervals, e.g. [3, 14, 30]. */
  intervalStage: number;
  /** ISO `YYYY-MM-DD`. */
  nextDueDate: string;
  history: { date: string; result: RevisionResult }[];
};

export type RevisionStore = Record<string, RevisionItem>;

/** ---------- Export payload (section 7) ---------- */

export type ExportPayload = {
  appVersion: string;
  exportedAt: string;
  curriculum: Subject[];
  planConfig: PlanConfig;
  progress: ProgressStore;
  revision: RevisionStore;
};

/** ---------- Schedule output (section 5) ---------- */

export type DayType = 'study' | 'buffer' | 'off';

export type ScheduleDay = {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  type: DayType;
  /** Present on `study` days and on `buffer` days (the subject being buffered). */
  subjectId?: string;
  subjectName?: string;
  /** Lectures assigned to this day (empty for buffer / off days). */
  lectureIds: string[];
  /** Effective (speed-adjusted) seconds planned for this day. */
  plannedSec: number;
  /** True when this date is in planConfig.leaveDates. */
  isLeaveDay: boolean;
  /** True when this date's weekday is not in planConfig.studyDays. */
  isNonStudyWeekday: boolean;
};
