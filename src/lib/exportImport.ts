/**
 * Backup export / import (sections 3.8 and 7).
 *
 * One JSON file carries every store. Import validates the shape *before*
 * committing anything: a malformed file is rejected with a clear error rather
 * than half-applied.
 */

import type { ExportPayload, PlanConfig, ProgressStore, RevisionStore, Subject } from '../types';
import { DEFAULT_REVISION_INTERVALS } from './revision';
import { isISODate } from './dates';

export const APP_VERSION = '1.0.0';
export const EXPORT_FILE_PREFIX = 'norcet-tracker-backup';

export function buildExportPayload(
  curriculum: Subject[],
  planConfig: PlanConfig,
  progress: ProgressStore,
  revision: RevisionStore,
): ExportPayload {
  return {
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    curriculum,
    planConfig,
    progress,
    revision,
  };
}

export function exportFileName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${EXPORT_FILE_PREFIX}-${stamp}.json`;
}

export function downloadJSON(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------- validation ------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Minimal but real schema check: enough to reject a wrong/corrupt file. */
export function validateExportPayload(raw: unknown): { ok: true; payload: ExportPayload } | { ok: false; error: string } {
  if (!isObject(raw)) return { ok: false, error: 'File is not a JSON object.' };

  if (!Array.isArray(raw.curriculum)) {
    return { ok: false, error: 'Missing "curriculum" array - this does not look like a NORCET Tracker backup.' };
  }
  for (const [i, subject] of raw.curriculum.entries()) {
    if (!isObject(subject) || typeof subject.id !== 'string' || typeof subject.name !== 'string') {
      return { ok: false, error: `curriculum[${i}] is not a valid subject (needs "id" and "name").` };
    }
    if (!Array.isArray(subject.topics)) {
      return { ok: false, error: `Subject "${subject.name}" has no "topics" array.` };
    }
    for (const [j, topic] of subject.topics.entries()) {
      if (!isObject(topic) || typeof topic.id !== 'string' || !Array.isArray(topic.lectures)) {
        return { ok: false, error: `Topic #${j + 1} of "${subject.name}" is not a valid topic.` };
      }
      for (const [k, lecture] of topic.lectures.entries()) {
        if (
          !isObject(lecture) ||
          typeof lecture.id !== 'string' ||
          typeof lecture.name !== 'string' ||
          typeof lecture.durationSec !== 'number'
        ) {
          return { ok: false, error: `Lecture #${k + 1} of topic #${j + 1} in "${subject.name}" is malformed.` };
        }
      }
    }
  }

  if (!isObject(raw.planConfig)) return { ok: false, error: 'Missing "planConfig".' };
  const plan = raw.planConfig;
  if (!Array.isArray(plan.subjectOrder)) return { ok: false, error: 'planConfig.subjectOrder must be an array.' };
  if (typeof plan.dailyHours !== 'number' || plan.dailyHours <= 0) {
    return { ok: false, error: 'planConfig.dailyHours must be a positive number.' };
  }
  if (!Array.isArray(plan.studyDays) || plan.studyDays.length === 0) {
    return { ok: false, error: 'planConfig.studyDays must list at least one weekday.' };
  }
  if (typeof plan.playbackSpeed !== 'number' || plan.playbackSpeed <= 0) {
    return { ok: false, error: 'planConfig.playbackSpeed must be a positive number.' };
  }
  if (!isISODate(plan.startDate)) return { ok: false, error: 'planConfig.startDate must be a YYYY-MM-DD date.' };
  if (!Array.isArray(plan.leaveDates)) return { ok: false, error: 'planConfig.leaveDates must be an array.' };
  if (!isObject(plan.bufferDaysBySubject)) {
    return { ok: false, error: 'planConfig.bufferDaysBySubject must be an object.' };
  }

  if (!isObject(raw.progress)) return { ok: false, error: 'Missing "progress" object.' };
  for (const [id, entry] of Object.entries(raw.progress)) {
    if (!isObject(entry) || typeof entry.lectureWatched !== 'boolean') {
      return { ok: false, error: `progress["${id}"] is malformed.` };
    }
  }

  if (raw.revision !== undefined && !isObject(raw.revision)) {
    return { ok: false, error: '"revision" must be an object when present.' };
  }

  return {
    ok: true,
    payload: {
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : APP_VERSION,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
      curriculum: raw.curriculum as unknown as Subject[],
      planConfig: normalizePlanConfig(plan),
      progress: raw.progress as ProgressStore,
      revision: (raw.revision ?? {}) as RevisionStore,
    },
  };
}

/** Fill in fields added after a backup was taken so old exports still load. */
export function normalizePlanConfig(plan: Record<string, unknown>): PlanConfig {
  return {
    subjectOrder: plan.subjectOrder as string[],
    dailyHours: plan.dailyHours as number,
    studyDays: plan.studyDays as number[],
    playbackSpeed: plan.playbackSpeed as number,
    bufferDaysBySubject: (plan.bufferDaysBySubject ?? {}) as Record<string, number>,
    leaveDates: ((plan.leaveDates ?? []) as unknown[]).filter((d): d is string => typeof d === 'string'),
    startDate: plan.startDate as string,
    bufferCountsOffDays: plan.bufferCountsOffDays !== false,
    revisionIntervals:
      Array.isArray(plan.revisionIntervals) && plan.revisionIntervals.length
        ? (plan.revisionIntervals as number[])
        : [...DEFAULT_REVISION_INTERVALS],
  };
}

export function defaultPlanConfig(startDate: string, subjectOrder: string[] = []): PlanConfig {
  return {
    subjectOrder,
    dailyHours: 3,
    studyDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
    playbackSpeed: 1.5,
    bufferDaysBySubject: {},
    leaveDates: [],
    startDate,
    bufferCountsOffDays: true,
    revisionIntervals: [...DEFAULT_REVISION_INTERVALS],
  };
}

/** Summary shown in the import confirmation step (section 3.8). */
export function payloadSummary(payload: ExportPayload): {
  subjects: number;
  lectures: number;
  progressEntries: number;
  watched: number;
  revisionItems: number;
  exportedAt: string | null;
} {
  let lectures = 0;
  for (const subject of payload.curriculum) {
    for (const topic of subject.topics) lectures += topic.lectures.length;
  }
  let watched = 0;
  for (const entry of Object.values(payload.progress)) if (entry.lectureWatched) watched++;
  return {
    subjects: payload.curriculum.length,
    lectures,
    progressEntries: Object.keys(payload.progress).length,
    watched,
    revisionItems: Object.keys(payload.revision ?? {}).length,
    exportedAt: payload.exportedAt ?? null,
  };
}
