import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVISION_INTERVALS,
  dueRevisions,
  markReviewed,
  skipRevision,
  stageLabel,
  syncRevisionQueue,
  upcomingRevisions,
} from '../src/lib/revision';
import { generateSchedule } from '../src/lib/schedule';
import { buildLectureIndex } from '../src/lib/parseCurriculum';
import { suggestBufferDays } from '../src/lib/buffer';
import { computePlanStats, computeTodayStats, dayCompletion } from '../src/lib/stats';
import { makePlan, makeSubjects, hours } from './helpers';
import type { LectureProgress, RevisionItem, RevisionStore } from '../src/types';

const TODAY = '2026-09-15';

function entry(over: Partial<LectureProgress> = {}): LectureProgress {
  return {
    lectureId: 'x',
    lectureWatched: false,
    notesDone: false,
    questionsDone: false,
    completedDate: null,
    ...over,
  };
}

describe('syncRevisionQueue', () => {
  it('only queues a lecture once all three boxes are ticked', () => {
    const partial = { a: entry({ lectureWatched: true, notesDone: true }) };
    expect(syncRevisionQueue(partial, {}, [3, 14, 30], TODAY).added).toBe(0);

    const full = { a: entry({ lectureWatched: true, notesDone: true, questionsDone: true }) };
    const { revision, added } = syncRevisionQueue(full, {}, [3, 14, 30], TODAY);
    expect(added).toBe(1);
    expect(revision.a).toMatchObject({ intervalStage: 0, nextDueDate: '2026-09-18' });
  });

  it('returns the same store reference when nothing changed', () => {
    const progress = { a: entry({ lectureWatched: true, notesDone: true, questionsDone: true }) };
    const first = syncRevisionQueue(progress, {}, [3], TODAY).revision;
    const second = syncRevisionQueue(progress, first, [3], TODAY);
    expect(second.added).toBe(0);
    expect(second.revision).toBe(first);
  });

  it('never re-creates an item that was already reviewed or dropped', () => {
    const progress = { a: entry({ lectureWatched: true, notesDone: true, questionsDone: true }) };
    const existing: RevisionStore = {
      a: { lectureId: 'a', intervalStage: 2, nextDueDate: '2026-10-01', history: [] },
    };
    const { revision, added } = syncRevisionQueue(progress, existing, [3, 14, 30], TODAY);
    expect(added).toBe(0);
    expect(revision.a.nextDueDate).toBe('2026-10-01');
  });
});

describe('markReviewed / skipRevision', () => {
  const item: RevisionItem = { lectureId: 'a', intervalStage: 0, nextDueDate: '2026-09-18', history: [] };

  it('advances to the next interval and records history', () => {
    const next = markReviewed(item, [3, 14, 30], TODAY);
    expect(next.intervalStage).toBe(1);
    expect(next.nextDueDate).toBe('2026-09-29'); // +14
    expect(next.history).toEqual([{ date: TODAY, result: 'done' }]);
  });

  it('loops on the last interval instead of graduating out of the queue', () => {
    let current = item;
    for (let i = 0; i < 5; i++) current = markReviewed(current, [3, 14, 30], TODAY);
    expect(current.intervalStage).toBe(2);
    expect(current.nextDueDate).toBe('2026-10-15'); // always +30 from here on
    expect(current.history.filter((h) => h.result === 'done')).toHaveLength(5);
  });

  it('skip moves a due item to tomorrow and records it', () => {
    const dueToday = { ...item, nextDueDate: TODAY };
    const skipped = skipRevision(dueToday, TODAY);
    expect(skipped.nextDueDate).toBe('2026-09-16');
    expect(skipped.intervalStage).toBe(0);
    expect(skipped.history).toEqual([{ date: TODAY, result: 'skipped' }]);

    // An item overdue by a week also lands on tomorrow, not back in the past.
    const overdue = { ...item, nextDueDate: '2026-09-08' };
    expect(skipRevision(overdue, TODAY).nextDueDate).toBe('2026-09-16');

    // An item not yet due is left alone (skip is only offered on due items).
    expect(skipRevision(item, TODAY).nextDueDate).toBe('2026-09-18');
  });

  it('labels stages for the UI', () => {
    expect(stageLabel(0, DEFAULT_REVISION_INTERVALS)).toBe('1st revision');
    expect(stageLabel(1, DEFAULT_REVISION_INTERVALS)).toBe('2nd revision');
    expect(stageLabel(2, DEFAULT_REVISION_INTERVALS)).toBe('3rd revision (repeat)');
  });
});

describe('due lists', () => {
  const revision: RevisionStore = {
    a: { lectureId: 'a', intervalStage: 0, nextDueDate: '2026-09-14', history: [] },
    b: { lectureId: 'b', intervalStage: 0, nextDueDate: '2026-09-15', history: [] },
    c: { lectureId: 'c', intervalStage: 1, nextDueDate: '2026-09-20', history: [] },
  };

  it('due today includes overdue items, oldest first', () => {
    expect(dueRevisions(revision, TODAY).map((i) => i.lectureId)).toEqual(['a', 'b']);
  });

  it('upcoming excludes due items', () => {
    expect(upcomingRevisions(revision, TODAY).map((i) => i.lectureId)).toEqual(['c']);
  });
});

describe('revision is decoupled from the schedule', () => {
  it('revision state never changes the generated plan', () => {
    const subjects = makeSubjects([hours('A', 1, 1), hours('B', 1)]);
    const plan = makePlan({
      subjectOrder: subjects.map((s) => s.id),
      startDate: TODAY,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
    });
    const progress = {
      [subjects[0].topics[0].lectures[0].id]: entry({
        lectureId: subjects[0].topics[0].lectures[0].id,
        lectureWatched: true,
        notesDone: true,
        questionsDone: true,
      }),
    };
    const withRevision = syncRevisionQueue(progress, {}, [3, 14, 30], TODAY).revision;
    const a = generateSchedule(subjects, plan, progress);
    const b = generateSchedule(subjects, plan, progress);
    expect(a).toEqual(b);
    // The revision store is a different object entirely and is not an input to
    // the scheduler at all.
    expect(Object.keys(withRevision)).toHaveLength(1);
  });
});

describe('stats helpers', () => {
  it('suggestBufferDays follows the documented tiers on effective hours', () => {
    expect(suggestBufferDays(10)).toBe(3);
    expect(suggestBufferDays(19.9)).toBe(3);
    expect(suggestBufferDays(20)).toBe(4);
    expect(suggestBufferDays(50)).toBe(5);
    expect(suggestBufferDays(120)).toBe(5);
    expect(suggestBufferDays(0)).toBe(0);
  });

  it('computePlanStats summarises a schedule', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1)]);
    const schedule = generateSchedule(
      subjects,
      makePlan({ subjectOrder: [subjects[0].id], dailyHours: 3, playbackSpeed: 1, startDate: TODAY }),
      {},
    );
    const stats = computePlanStats(schedule);
    expect(stats).toMatchObject({ studyDays: 2, remainingLectures: 4, totalDays: 2 });
    expect(stats.finishDate).toBe('2026-09-16');
  });

  it('dayCompletion counts the three independent flags', () => {
    const subjects = makeSubjects([hours('A', 1, 1)]);
    const index = buildLectureIndex(subjects);
    const schedule = generateSchedule(
      subjects,
      makePlan({ subjectOrder: [subjects[0].id], dailyHours: 3, playbackSpeed: 1, startDate: TODAY }),
      {},
    );
    const id = subjects[0].topics[0].lectures[0].id;
    const progress = {
      [id]: entry({ lectureId: id, lectureWatched: true, notesDone: true }),
    };
    expect(dayCompletion(schedule[0], progress, index)).toEqual({
      total: 2,
      watched: 1,
      notes: 1,
      questions: 0,
      plannedSec: 7200,
      doneSec: 3600,
      allDone: false,
    });
  });

  it("computeTodayStats reports ahead / behind without reflowing anything", () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1, 1, 1)]);
    const plan = makePlan({
      subjectOrder: [subjects[0].id],
      dailyHours: 3,
      playbackSpeed: 1,
      startDate: TODAY,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
    });
    // Two days in, nothing watched -> behind with a backlog.
    const schedule = generateSchedule(subjects, plan, {});
    const behind = computeTodayStats(subjects, plan, {}, schedule, '2026-09-17');
    expect(behind.backlogLectures).toBe(6);
    expect(behind.deltaDays).toBeLessThan(0);

    // Everything watched -> ahead.
    const progress = Object.fromEntries(
      subjects[0].topics[0].lectures.map((l) => [l.id, entry({ lectureId: l.id, lectureWatched: true })]),
    );
    const scheduleAfter = generateSchedule(subjects, plan, progress);
    const ahead = computeTodayStats(subjects, plan, progress, scheduleAfter, '2026-09-17');
    expect(ahead.backlogLectures).toBe(0);
    expect(ahead.deltaDays).toBeGreaterThan(0);
  });
});
