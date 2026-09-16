/**
 * Backup export / import (sections 3.8 and 7).
 *
 * One JSON file carries every store. Import validates the shape *before*
 * committing anything: a malformed file is rejected with a clear error rather
 * than half-applied.
 */

import type { ExportPayload, PlanConfig, ProgressStore, RevisionStore, Subject } from '../types';
import { isISODate, todayISO } from './dates';
import { DEFAULT_REVISION_INTERVALS } from './revision';

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

/**
 * UTF-8-safe base64 for the native export path: @capacitor/filesystem's
 * `writeFile` only accepts base64 `data` (raw JSON fails on the native side
 * with "The supplied data is not valid base64 content").
 *
 * `btoa` alone is Latin-1 only and throws on non-Latin-1 text (curly quotes
 * in names, other scripts), so encode via TextEncoder first, and build the
 * binary string in chunks so very large backups don't blow the call stack.
 */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
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

/**
 * Fill in / repair fields so old exports, hand-edited files and partially
 * valid payloads still load. Every field falls back to a safe default rather
 * than trusting a cast: an invalid start date or a missing study-day list
 * would otherwise corrupt the generated plan (see PaceControls' cleared
 * start-date bug).
 */
export function normalizePlanConfig(plan: Record<string, unknown>): PlanConfig {
  const subjectOrder = Array.isArray(plan.subjectOrder)
    ? (plan.subjectOrder as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  const dailyHours =
    typeof plan.dailyHours === 'number' && Number.isFinite(plan.dailyHours) && plan.dailyHours > 0
      ? plan.dailyHours
      : 3;
  const studyDays = Array.isArray(plan.studyDays)
    ? (plan.studyDays as unknown[])
        .filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
    : [];
  const playbackSpeed =
    typeof plan.playbackSpeed === 'number' && Number.isFinite(plan.playbackSpeed) && plan.playbackSpeed > 0
      ? plan.playbackSpeed
      : 1.5;
  const bufferDaysBySubject: Record<string, number> = {};
  if (isObject(plan.bufferDaysBySubject)) {
    for (const [k, v] of Object.entries(plan.bufferDaysBySubject)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 60) bufferDaysBySubject[k] = Math.round(v);
    }
  }
  const revisionIntervals = Array.isArray(plan.revisionIntervals)
    ? (plan.revisionIntervals as unknown[]).filter(
        (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1,
      )
    : [];
  return {
    subjectOrder,
    dailyHours,
    studyDays: studyDays.length ? studyDays : [1, 2, 3, 4, 5, 6],
    playbackSpeed,
    bufferDaysBySubject,
    leaveDates: ((plan.leaveDates ?? []) as unknown[]).filter((d): d is string => isISODate(d)),
    startDate: isISODate(plan.startDate) ? plan.startDate : todayISO(),
    bufferCountsOffDays: plan.bufferCountsOffDays !== false,
    revisionIntervals: revisionIntervals.length ? revisionIntervals : [...DEFAULT_REVISION_INTERVALS],
    studentName: typeof plan.studentName === 'string' ? plan.studentName : '',
    offDayLectures: isObject(plan.offDayLectures)
      ? (Object.fromEntries(
          Object.entries(plan.offDayLectures).filter(([, v]) => isISODate(v)),
        ) as Record<string, string>)
      : {},
    backlogAnchor: isISODate(plan.backlogAnchor) ? (plan.backlogAnchor as string) : null,
    dayHours: isObject(plan.dayHours)
      ? (Object.fromEntries(
          Object.entries(plan.dayHours).filter(
            ([k, v]) => isISODate(k) && typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 16,
          ),
        ) as Record<string, number>)
      : {},
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
    studentName: '',
    offDayLectures: {},
    backlogAnchor: null,
    dayHours: {},
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
