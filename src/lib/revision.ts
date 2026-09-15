/**
 * Revision queue (section 6).
 *
 * Completely decoupled from the main schedule:
 *  - it READS ProgressStore to know which lectures are eligible
 *    (all three checkboxes ticked),
 *  - it WRITES only to RevisionStore,
 *  - it never consumes "daily hours" and never appears in generateSchedule.
 */

import type { ProgressStore, RevisionItem, RevisionStore } from '../types';
import { addDays, todayISO } from './dates';

export const DEFAULT_REVISION_INTERVALS = [3, 14, 30];

/**
 * A lecture becomes revision-eligible once lecture + notes + questions are all
 * done. Returns a NEW store when something changed, or the SAME reference when
 * nothing did (so callers can skip writes).
 */
export function syncRevisionQueue(
  progress: ProgressStore,
  revision: RevisionStore,
  intervals: number[],
  today: string = todayISO(),
): { revision: RevisionStore; added: number } {
  const list = intervals.length ? intervals : DEFAULT_REVISION_INTERVALS;
  const first = Math.max(1, Math.round(list[0]));
  let next: RevisionStore | null = null;
  let added = 0;

  for (const [lectureId, p] of Object.entries(progress)) {
    if (!p.lectureWatched || !p.notesDone || !p.questionsDone) continue;
    if (revision[lectureId]) continue;
    if (!next) next = { ...revision };
    next[lectureId] = {
      lectureId,
      intervalStage: 0,
      nextDueDate: addDays(today, first),
      history: [],
    };
    added++;
  }

  return { revision: next ?? revision, added };
}

/**
 * "Mark reviewed": advance to the next interval.
 *
 * When the last interval is reached we LOOP BACK onto it (documented choice in
 * the spec: "pick looping-on-last-interval as the default so nothing ever fully
 * disappears from revision"). So with [3, 14, 30] a lecture is seen again after
 * 3 days, 14 days, then every 30 days for as long as the student keeps it up.
 */
export function markReviewed(
  item: RevisionItem,
  intervals: number[],
  today: string = todayISO(),
): RevisionItem {
  const list = intervals.length ? intervals : DEFAULT_REVISION_INTERVALS;
  const lastStage = list.length - 1;
  const rawStage = item.intervalStage + 1;
  const stage = rawStage > lastStage ? lastStage : rawStage;
  const days = Math.max(1, Math.round(list[stage]));
  return {
    ...item,
    intervalStage: stage,
    nextDueDate: addDays(today, days),
    history: [...item.history, { date: today, result: 'done' as const }],
  };
}

/**
 * "Skip": "not now, remind me tomorrow".
 *
 * The item moves to tomorrow (or keeps its later date if it was already
 * scheduled beyond tomorrow). Chosen over "leave it due" because an item you
 * keep declining has to get out of the way: if it stayed due forever the Due
 * list would never shrink and the tab would become useless. One day is the
 * smallest nudge that keeps it visible. The skip is recorded in the history.
 */
export function skipRevision(
  item: RevisionItem,
  today: string = todayISO(),
): RevisionItem {
  const tomorrow = addDays(today, 1);
  return {
    ...item,
    nextDueDate: tomorrow > item.nextDueDate ? tomorrow : item.nextDueDate,
    history: [...item.history, { date: today, result: 'skipped' as const }],
  };
}

export type DueFilter = { today: string };

/** Items due on or before `today`, oldest due date first. */
export function dueRevisions(
  revision: RevisionStore,
  today: string = todayISO(),
): RevisionItem[] {
  return Object.values(revision)
    .filter((item) => item.nextDueDate <= today)
    .sort((a, b) => (a.nextDueDate === b.nextDueDate ? 0 : a.nextDueDate < b.nextDueDate ? -1 : 1));
}

/** Everything else, soonest first. */
export function upcomingRevisions(
  revision: RevisionStore,
  today: string = todayISO(),
  limit = 50,
): RevisionItem[] {
  return Object.values(revision)
    .filter((item) => item.nextDueDate > today)
    .sort((a, b) => (a.nextDueDate === b.nextDueDate ? 0 : a.nextDueDate < b.nextDueDate ? -1 : 1))
    .slice(0, limit);
}

/** Human label for the stage, e.g. `0 -> "1st revision"`, `3 -> "4th revision"`. */
export function stageLabel(stage: number, intervals: number[]): string {
  const n = stage + 1;
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  const repeating = intervals.length > 0 && stage >= intervals.length - 1;
  return `${n}${suffix} revision${repeating ? ' (repeat)' : ''}`;
}
