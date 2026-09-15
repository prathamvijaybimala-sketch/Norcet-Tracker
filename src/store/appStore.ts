/**
 * Application store.
 *
 * Holds the three persisted slices (curriculum / planConfig / progress) plus the
 * revision queue, and DERIVES the schedule + lookup indexes on every mutation.
 * The schedule itself is never persisted (section 2.5).
 */

import { create } from 'zustand';
import type {
  LectureProgress,
  PlanConfig,
  ProgressStore,
  RevisionStore,
  ScheduleDay,
  Subject,
} from '../types';
import { todayISO } from '../lib/dates';
import { buildLectureIndex, parseCurriculumDetailed, subjectStats, type LectureRef } from '../lib/parseCurriculum';
import {
  catchUpPlan,
  generateSchedule,
  indexScheduleByDate,
  indexScheduleByLecture,
  nextOffDayOnOrAfter,
  nextStudyDateOnOrAfter,
} from '../lib/schedule';
import { suggestBufferForSubject } from '../lib/buffer';
import {
  DEFAULT_REVISION_INTERVALS,
  markReviewed as markReviewedPure,
  skipRevision as skipRevisionPure,
  syncRevisionQueue,
} from '../lib/revision';
import { defaultPlanConfig, downloadJSON, buildExportPayload, exportFileName, normalizePlanConfig } from '../lib/exportImport';
import { hashPlanPassword, MIN_LOCK_LENGTH, sameHash } from '../lib/lock';
import { clearAll, flushWrites, loadAll, normalizeSettings, saveKeyDebounced } from '../lib/storage';
import { KEYS } from '../lib/storage';

export type ProgressFlag = 'lectureWatched' | 'notesDone' | 'questionsDone';

export type MarkFlags = {
  lectureWatched?: boolean;
  notesDone?: boolean;
  questionsDone?: boolean;
};

export type Route = 'import' | 'setup' | 'today' | 'timeline' | 'subjects' | 'revision' | 'data';

type Derived = {
  lectureIndex: Map<string, LectureRef>;
  schedule: ScheduleDay[];
  scheduleByDate: Map<string, ScheduleDay>;
  scheduleByLecture: Map<string, string>;
};

type Versions = { curriculum: number; plan: number; progress: number; revision: number };

/** Which slices a mutation touched. */
type Changed = {
  curriculum?: boolean;
  plan?: boolean;
  progress?: boolean;
  revision?: boolean;
};

export type AppState = {
  ready: boolean;
  route: Route;
  curriculum: Subject[];
  planConfig: PlanConfig;
  progress: ProgressStore;
  revision: RevisionStore;
  versions: Versions;
  toast: { id: number; message: string } | null;
  /** Per-device theme (persisted outside the export payload). */
  theme: 'dark' | 'light';
  /** Hash of the plan-screen password, or null when the plan is not locked. */
  planLockHash: string | null;
  /** Session-only: true after the plan screen has been unlocked this launch. */
  planUnlocked: boolean;
} & Derived;

type Actions = {
  init: () => Promise<void>;
  setRoute: (route: Route) => void;
  notify: (message: string) => void;
  dismissToast: () => void;

  importCurriculum: (raw: string) => { subjects: number; lectures: number; warnings: number };
  clearCurriculum: () => void;

  updatePlan: (patch: Partial<PlanConfig>) => void;
  setSubjectOrder: (order: string[]) => void;
  moveSubject: (from: number, to: number) => void;
  setSubjectIncluded: (subjectId: string, included: boolean) => void;
  ensureBufferDefaults: () => void;
  setBuffer: (subjectId: string, days: number) => void;
  toggleLeave: (date: string) => void;
  addLeaveDates: (dates: string[]) => void;
  removeLeaveDate: (date: string) => void;
  catchUp: () => void;

  setFlag: (lectureId: string, flag: ProgressFlag, value: boolean) => void;
  setFlags: (lectureId: string, patch: MarkFlags) => void;
  bulkMark: (lectureIds: string[], patch: MarkFlags) => void;

  markSubjectDone: (subjectId: string, patch: MarkFlags) => void;
  markTopicDone: (topicId: string, patch: MarkFlags) => void;
  markFirstN: (subjectId: string, n: number, patch: MarkFlags) => void;

  setRevisionIntervals: (intervals: number[]) => void;
  reviewLecture: (lectureId: string) => void;
  skipLectureReview: (lectureId: string) => void;
  removeRevision: (lectureId: string) => void;

  /** Backlog: move a missed lecture onto an off day (defaults to the next one). */
  moveLectureToOffDay: (lectureId: string, date?: string) => void;
  /** Backlog: take a lecture back off its off day into the normal queue. */
  returnLectureFromOffDay: (lectureId: string) => void;
  /** Backlog: re-spread the plan from today, opening the next off day for overflow. */
  shiftScheduleFromBacklog: () => void;
  /** Topic-level "Questions" checkbox: tick / untick every lecture of a topic. */
  setTopicQuestions: (topicId: string, value: boolean) => void;

  /** Per-device preferences. */
  setTheme: (theme: 'dark' | 'light') => void;
  setPlanPassword: (password: string) => Promise<boolean>;
  checkPlanPassword: (password: string) => Promise<boolean>;
  clearPlanPassword: () => void;
  lockPlan: () => void;

  exportData: () => Promise<void>;
  applyBackup: (state: {
    curriculum: Subject[];
    planConfig: PlanConfig;
    progress: ProgressStore;
    revision: RevisionStore;
  }) => void;
  resetEverything: () => Promise<void>;
};

const EMPTY_DERIVED: Derived = {
  lectureIndex: new Map(),
  schedule: [],
  scheduleByDate: new Map(),
  scheduleByLecture: new Map(),
};

function derive(
  curriculum: Subject[],
  planConfig: PlanConfig,
  progress: ProgressStore,
): Derived {
  const lectureIndex = buildLectureIndex(curriculum);
  const schedule = generateSchedule(curriculum, planConfig, progress);
  return {
    lectureIndex,
    schedule,
    scheduleByDate: indexScheduleByDate(schedule),
    scheduleByLecture: indexScheduleByLecture(schedule),
  };
}

/** Write one progress entry, maintaining `completedDate`. */
function writeProgress(
  progress: ProgressStore,
  lectureId: string,
  patch: MarkFlags,
  today: string,
): ProgressStore {
  const current = progress[lectureId];
  const base: LectureProgress = current ?? {
    lectureId,
    lectureWatched: false,
    notesDone: false,
    questionsDone: false,
    completedDate: null,
  };
  const next: LectureProgress = { ...base, ...patch };
  if (patch.lectureWatched === true) {
    if (next.completedDate == null) next.completedDate = today;
  } else if (patch.lectureWatched === false) {
    next.completedDate = null;
  }
  return { ...progress, [lectureId]: next };
}

function writeBulk(
  progress: ProgressStore,
  lectureIds: string[],
  patch: MarkFlags,
  today: string,
): ProgressStore {
  let next = progress;
  for (const id of lectureIds) next = writeProgress(next, id, patch, today);
  return next;
}

let hydrated = false;

export const useAppStore = create<AppState & Actions>((set, get) => {
  /** Persist whichever slices changed since the last save. */
  let lastSaved: Versions = { curriculum: -1, plan: -1, progress: -1, revision: -1 };
  let settingsDirty = true; // first launch: write the defaults
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const persist = () => {
    const { versions, curriculum, planConfig, progress, revision, theme, planLockHash } = get();
    if (versions.curriculum !== lastSaved.curriculum) {
      saveKeyDebounced(KEYS.curriculum, curriculum);
    }
    if (versions.plan !== lastSaved.plan) {
      saveKeyDebounced(KEYS.planConfig, planConfig);
    }
    if (versions.progress !== lastSaved.progress) {
      saveKeyDebounced(KEYS.progress, progress);
    }
    if (versions.revision !== lastSaved.revision) {
      saveKeyDebounced(KEYS.revision, revision);
    }
    if (settingsDirty) {
      saveKeyDebounced(KEYS.settings, { theme, planLockHash });
      settingsDirty = false;
    }
    lastSaved = { ...versions };
  };

  /** Commit a partial state update, re-deriving + persisting as needed. */
  const commit = (patch: Partial<AppState>, changed: Changed) => {
    const state = get();
    const next = {
      curriculum: patch.curriculum ?? state.curriculum,
      planConfig: patch.planConfig ?? state.planConfig,
      progress: patch.progress ?? state.progress,
      revision: patch.revision ?? state.revision,
    };
    const versions: Versions = {
      curriculum: state.versions.curriculum + (changed.curriculum ? 1 : 0),
      plan: state.versions.plan + (changed.plan ? 1 : 0),
      progress: state.versions.progress + (changed.progress ? 1 : 0),
      revision: state.versions.revision + (changed.revision ? 1 : 0),
    };
    const needsDerive = Boolean(changed.curriculum || changed.plan || changed.progress);
    set({
      ...patch,
      versions,
      ...(needsDerive ? derive(next.curriculum, next.planConfig, next.progress) : null),
    });
    persist();
  };

  const syncRevision = (progress: ProgressStore, revision: RevisionStore, intervals: number[]) => {
    const { revision: nextRevision } = syncRevisionQueue(progress, revision, intervals);
    return nextRevision;
  };

  return {
    ready: false,
    route: 'import',
    curriculum: [],
    planConfig: defaultPlanConfig(todayISO()),
    progress: {},
    revision: {},
    versions: { curriculum: 0, plan: 0, progress: 0, revision: 0 },
    toast: null,
    theme: 'dark',
    planLockHash: null,
    planUnlocked: false,
    ...EMPTY_DERIVED,

    async init() {
      // Guard against double-invocation (React StrictMode runs effects twice in
      // dev): hydration must never clobber state the user has already created.
      if (hydrated) return;
      hydrated = true;
      const stored = await loadAll();
      const curriculum = Array.isArray(stored.curriculum) ? stored.curriculum : [];
      const planConfig = stored.planConfig
        ? normalizePlanConfig(stored.planConfig as unknown as Record<string, unknown>)
        : defaultPlanConfig(todayISO(), curriculum.map((s) => s.id));
      const progress = stored.progress && typeof stored.progress === 'object' ? stored.progress : {};
      const revision = stored.revision && typeof stored.revision === 'object' ? stored.revision : {};
      const settings = normalizeSettings(stored.settings);

      lastSaved = { curriculum: 0, plan: 0, progress: 0, revision: 0 };
      settingsDirty = false; // just read it; nothing to write back yet
      set({
        ready: true,
        route: curriculum.length ? 'today' : 'import',
        curriculum,
        planConfig,
        progress,
        revision,
        theme: settings.theme,
        planLockHash: settings.planLockHash,
        planUnlocked: false, // the plan re-locks on every app launch
        versions: { curriculum: curriculum.length ? 1 : 0, plan: 1, progress: 1, revision: 1 },
        ...derive(curriculum, planConfig, progress),
      });
    },

    setRoute(route) {
      set({ route });
      if (typeof window !== 'undefined') window.location.hash = `#/${route}`;
    },

    notify(message) {
      const id = Date.now();
      set({ toast: { id, message } });
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => set({ toast: null }), 4000);
    },

    dismissToast() {
      set({ toast: null });
    },

    importCurriculum(raw) {
      const { subjects, warnings } = parseCurriculumDetailed(raw);
      const state = get();

      // Progress is preserved by lecture id: re-importing the same file (or a
      // newer version of it) updates names/durations but never orphans progress.
      const freshIds = new Set<string>();
      for (const subject of subjects) {
        for (const topic of subject.topics) {
          for (const lecture of topic.lectures) freshIds.add(lecture.id);
        }
      }
      const orphaned = Object.keys(state.progress).filter((id) => !freshIds.has(id));

      const previousOrder = state.planConfig.subjectOrder;
      const known = new Set(previousOrder);
      const subjectOrder = [
        ...previousOrder.filter((id) => subjects.some((s) => s.id === id)),
        ...subjects.filter((s) => !known.has(s.id)).map((s) => s.id),
      ];

      const bufferDaysBySubject = { ...state.planConfig.bufferDaysBySubject };
      for (const subject of subjects) {
        if (bufferDaysBySubject[subject.id] === undefined) {
          bufferDaysBySubject[subject.id] = suggestBufferForSubject(
            subjectStats(subject).totalSec,
            state.planConfig.playbackSpeed,
          );
        }
      }

      const planConfig: PlanConfig = { ...state.planConfig, subjectOrder, bufferDaysBySubject };
      commit({ curriculum: subjects, planConfig, route: 'today' }, { curriculum: true, plan: true });
      if (typeof window !== 'undefined') window.location.hash = '#/today';
      return {
        subjects: subjects.length,
        lectures: freshIds.size,
        warnings: warnings.length + (orphaned.length ? 1 : 0),
      };
    },

    clearCurriculum() {
      commit({ curriculum: [], progress: {}, revision: {} }, { curriculum: true, progress: true, revision: true });
      set({ route: 'import' });
      if (typeof window !== 'undefined') window.location.hash = '#/import';
    },

    updatePlan(patch) {
      // Manually moving the start date invalidates a previous "shift the
      // schedule" anchor (its overflow day no longer means anything), unless
      // the caller sets a fresh anchor in the same patch.
      const next = { ...get().planConfig, ...patch };
      if (patch.startDate !== undefined && patch.backlogAnchor === undefined) {
        next.backlogAnchor = null;
      }
      commit({ planConfig: next }, { plan: true });
    },

    setSubjectOrder(order) {
      get().updatePlan({ subjectOrder: order });
    },

    moveSubject(from, to) {
      const order = [...get().planConfig.subjectOrder];
      if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      get().updatePlan({ subjectOrder: order });
    },

    setSubjectIncluded(subjectId, included) {
      const order = get().planConfig.subjectOrder;
      const has = order.includes(subjectId);
      if (included === has) return;
      const next = included
        ? // Re-adding puts the subject at the end; user can drag it back up.
          [...order, subjectId]
        : order.filter((id) => id !== subjectId);
      get().updatePlan({ subjectOrder: next });
    },

    ensureBufferDefaults() {
      const { curriculum, planConfig } = get();
      const buffers = { ...planConfig.bufferDaysBySubject };
      let changed = false;
      for (const subject of curriculum) {
        if (buffers[subject.id] === undefined) {
          buffers[subject.id] = suggestBufferForSubject(
            subjectStats(subject).totalSec,
            planConfig.playbackSpeed,
          );
          changed = true;
        }
      }
      if (changed) get().updatePlan({ bufferDaysBySubject: buffers });
    },

    setBuffer(subjectId, days) {
      const value = Math.max(0, Math.min(60, Math.round(Number.isFinite(days) ? days : 0)));
      get().updatePlan({
        bufferDaysBySubject: { ...get().planConfig.bufferDaysBySubject, [subjectId]: value },
      });
    },

    toggleLeave(date) {
      const { leaveDates } = get().planConfig;
      get().updatePlan({
        leaveDates: leaveDates.includes(date)
          ? leaveDates.filter((d) => d !== date)
          : [...leaveDates, date].sort(),
      });
    },

    addLeaveDates(dates) {
      const set0 = new Set(get().planConfig.leaveDates);
      for (const d of dates) set0.add(d);
      get().updatePlan({ leaveDates: Array.from(set0).sort() });
    },

    removeLeaveDate(date) {
      get().updatePlan({ leaveDates: get().planConfig.leaveDates.filter((d) => d !== date) });
    },

    catchUp() {
      const { planConfig } = get();
      const next = catchUpPlan(planConfig, todayISO());
      if (next === planConfig) {
        get().notify('Nothing to catch up - the plan already starts today or later.');
        return;
      }
      // Pass backlogAnchor through untouched: catchUpPlan anchors the shift.
      get().updatePlan(next);
      get().notify(`Plan restarted from today. ${next.leaveDates.length} future leave days kept.`);
    },

    moveLectureToOffDay(lectureId, date) {
      const { planConfig } = get();
      let target = date && date >= planConfig.startDate ? date : null;
      if (!target) {
        target = nextOffDayOnOrAfter(todayISO(), planConfig, 60);
        if (!target) {
          get().notify('No off day found - your plan currently studies every weekday.');
          return;
        }
      }
      const { offDayLectures } = planConfig;
      get().updatePlan({ offDayLectures: { ...offDayLectures, [lectureId]: target } });
      get().notify(`Lecture moved to ${target} (off day). It will be waiting for you there.`);
    },

    returnLectureFromOffDay(lectureId) {
      const { offDayLectures } = get().planConfig;
      if (!(lectureId in offDayLectures)) return;
      const next = { ...offDayLectures };
      delete next[lectureId];
      get().updatePlan({ offDayLectures: next });
      get().notify('Lecture returned to the normal plan.');
    },

    shiftScheduleFromBacklog() {
      const { planConfig } = get();
      const today = todayISO();
      const anchor = nextStudyDateOnOrAfter(today, planConfig);
      get().updatePlan({
        startDate: anchor,
        backlogAnchor: anchor,
        // Past leave days can no longer shift anything.
        leaveDates: planConfig.leaveDates.filter((d) => d >= anchor),
      });
      get().notify(
        `Schedule shifted from ${anchor}. The next off day is open for the extra lecture.`,
      );
    },

    setTopicQuestions(topicId, value) {
      const { curriculum } = get();
      const ids: string[] = [];
      for (const subject of curriculum) {
        for (const topic of subject.topics) {
          if (topic.id === topicId) for (const l of topic.lectures) ids.push(l.id);
        }
      }
      if (!ids.length) return;
      get().bulkMark(ids, { questionsDone: value });
    },

    setFlag(lectureId, flag, value) {
      get().setFlags(lectureId, { [flag]: value } as MarkFlags);
    },

    setFlags(lectureId, patch) {
      const { progress, revision, planConfig } = get();
      const nextProgress = writeProgress(progress, lectureId, patch, todayISO());
      const nextRevision = syncRevision(nextProgress, revision, planConfig.revisionIntervals);
      commit(
        { progress: nextProgress, revision: nextRevision },
        { progress: true, revision: nextRevision !== revision },
      );
    },

    bulkMark(lectureIds, patch) {
      if (!lectureIds.length) return;
      const { progress, revision, planConfig } = get();
      const nextProgress = writeBulk(progress, lectureIds, patch, todayISO());
      const nextRevision = syncRevision(nextProgress, revision, planConfig.revisionIntervals);
      commit(
        { progress: nextProgress, revision: nextRevision },
        { progress: true, revision: nextRevision !== revision },
      );
      get().notify(`Updated ${lectureIds.length} lecture${lectureIds.length === 1 ? '' : 's'}.`);
    },

    markSubjectDone(subjectId, patch) {
      const subject = get().curriculum.find((s) => s.id === subjectId);
      if (!subject) return;
      const ids: string[] = [];
      for (const topic of subject.topics) for (const l of topic.lectures) ids.push(l.id);
      get().bulkMark(ids, patch);
    },

    markTopicDone(topicId, patch) {
      const ids: string[] = [];
      for (const subject of get().curriculum) {
        for (const topic of subject.topics) {
          if (topic.id === topicId) {
            for (const l of topic.lectures) ids.push(l.id);
          }
        }
      }
      get().bulkMark(ids, patch);
    },

    markFirstN(subjectId, n, patch) {
      const subject = get().curriculum.find((s) => s.id === subjectId);
      if (!subject) return;
      const ids: string[] = [];
      for (const topic of subject.topics) {
        for (const l of topic.lectures) {
          if (ids.length >= n) break;
          ids.push(l.id);
        }
      }
      get().bulkMark(ids, patch);
    },

    setRevisionIntervals(intervals) {
      const cleaned = intervals.map((n) => Math.max(1, Math.round(n))).filter((n) => Number.isFinite(n));
      get().updatePlan({
        revisionIntervals: cleaned.length ? cleaned : [...DEFAULT_REVISION_INTERVALS],
      });
    },

    reviewLecture(lectureId) {
      const { revision, planConfig } = get();
      const item = revision[lectureId];
      if (!item) return;
      const next = {
        ...revision,
        [lectureId]: markReviewedPure(item, planConfig.revisionIntervals, todayISO()),
      };
      commit({ revision: next }, { revision: true });
    },

    skipLectureReview(lectureId) {
      const { revision } = get();
      const item = revision[lectureId];
      if (!item) return;
      commit(
        { revision: { ...revision, [lectureId]: skipRevisionPure(item, todayISO()) } },
        { revision: true },
      );
    },

    removeRevision(lectureId) {
      const { revision } = get();
      if (!revision[lectureId]) return;
      const next = { ...revision };
      delete next[lectureId];
      commit({ revision: next }, { revision: true });
    },

    setTheme(theme) {
      set({ theme });
      settingsDirty = true;
      persist();
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = theme;
      }
    },

    async setPlanPassword(password) {
      if (password.length < MIN_LOCK_LENGTH) return false;
      const hash = await hashPlanPassword(password);
      set({ planLockHash: hash, planUnlocked: true });
      settingsDirty = true;
      persist();
      return true;
    },

    async checkPlanPassword(password) {
      const stored = get().planLockHash;
      if (!stored) {
        // No lock set - nothing to check (the caller shows the setup card).
        return true;
      }
      const hash = await hashPlanPassword(password);
      const ok = sameHash(hash, stored);
      if (ok) set({ planUnlocked: true });
      return ok;
    },

    clearPlanPassword() {
      set({ planLockHash: null, planUnlocked: false });
      settingsDirty = true;
      persist();
    },

    lockPlan() {
      set({ planUnlocked: false });
    },

    async exportData() {
      // Flush first so the file always contains the very latest state.
      await flushWrites();
      const { curriculum, planConfig, progress, revision } = get();
      const payload = buildExportPayload(curriculum, planConfig, progress, revision);
      downloadJSON(exportFileName(), payload);
    },

    applyBackup({ curriculum, planConfig, progress, revision }) {
      commit(
        { curriculum, planConfig, progress, revision },
        { curriculum: true, plan: true, progress: true, revision: true },
      );
      set({ route: curriculum.length ? 'today' : 'import' });
      if (typeof window !== 'undefined') window.location.hash = curriculum.length ? '#/today' : '#/import';
    },

    async resetEverything() {
      hydrated = false;
      await clearAll();
      const today = todayISO();
      lastSaved = { curriculum: -1, plan: -1, progress: -1, revision: -1 };
      settingsDirty = true; // rewrite the default settings
      set({
        curriculum: [],
        planConfig: defaultPlanConfig(today),
        progress: {},
        revision: {},
        versions: { curriculum: 0, plan: 0, progress: 0, revision: 0 },
        route: 'import',
        theme: 'dark',
        planLockHash: null,
        planUnlocked: false,
        ...EMPTY_DERIVED,
      });
      if (typeof document !== 'undefined') document.documentElement.dataset.theme = 'dark';
      if (typeof window !== 'undefined') window.location.hash = '#/import';
    },
  };
});

/* ------------------------------ selectors ------------------------------ */

export const selectToday = (state: AppState) => state.scheduleByDate;

export function useLectureRef(lectureId: string): LectureRef | undefined {
  return useAppStore((s) => s.lectureIndex.get(lectureId));
}

export function useLectureProgress(lectureId: string): LectureProgress | undefined {
  return useAppStore((s) => s.progress[lectureId]);
}
