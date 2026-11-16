import { describe, expect, it } from 'vitest';
import { computeStreak } from '../src/lib/streak';
import type { LectureProgress, ProgressStore, ScheduleDay } from '../src/types';

function studyDay(date: string, ids: string[]): ScheduleDay {
  return {
    date,
    type: 'study',
    subjectId: 's',
    subjectName: 'S',
    lectureIds: ids,
    plannedSec: 0,
    isLeaveDay: false,
    isNonStudyWeekday: false,
  };
}

function bufferDay(date: string): ScheduleDay {
  return {
    date,
    type: 'buffer',
    subjectId: 's',
    subjectName: 'S',
    lectureIds: [],
    plannedSec: 0,
    isLeaveDay: false,
    isNonStudyWeekday: false,
  };
}

function watched(date: string, ids: string[]): Record<string, LectureProgress> {
  const out: Record<string, LectureProgress> = {};
  for (const id of ids) {
    out[id] = {
      lectureId: id,
      lectureWatched: true,
      notesDone: false,
      questionsDone: false,
      completedDate: date,
    };
  }
  return out;
}

describe('computeStreak', () => {
  it('counts consecutive watched study days and skips buffer days', () => {
    const schedule: ScheduleDay[] = [
      studyDay('2026-09-10', ['a1']),
      studyDay('2026-09-11', ['b1']),
      bufferDay('2026-09-12'),
      studyDay('2026-09-13', ['c1']),
      studyDay('2026-09-14', ['d1']),
    ];
    const progress: ProgressStore = {
      ...watched('2026-09-10', ['a1']),
      ...watched('2026-09-11', ['b1']),
      ...watched('2026-09-13', ['c1']),
      ...watched('2026-09-14', ['d1']),
    };
    expect(computeStreak(progress, schedule, '2026-09-14')).toBe(4);
    // the buffer day in the middle did NOT break it
  });

  it('a planned study day with zero watches ends the streak', () => {
    const schedule: ScheduleDay[] = [
      studyDay('2026-09-10', ['a1']),
      studyDay('2026-09-11', ['b1']),
      bufferDay('2026-09-12'),
      studyDay('2026-09-13', ['c1']),
      studyDay('2026-09-14', ['d1']),
    ];
    const progress: ProgressStore = {
      ...watched('2026-09-10', ['a1']),
      ...watched('2026-09-11', ['b1']),
      // 09-13 skipped entirely
      ...watched('2026-09-14', ['d1']),
    };
    expect(computeStreak(progress, schedule, '2026-09-14')).toBe(1);
  });

  it('lectures marked "done before the app" (preDone) never count', () => {
    const schedule: ScheduleDay[] = [
      studyDay('2026-09-13', ['c1']),
      studyDay('2026-09-14', ['d1']),
    ];
    const progress: ProgressStore = {
      c1: {
        lectureId: 'c1',
        lectureWatched: true,
        notesDone: false,
        questionsDone: false,
        completedDate: null,
        preDone: true,
      },
      ...watched('2026-09-14', ['d1']),
    };
    expect(computeStreak(progress, schedule, '2026-09-14')).toBe(1);
  });

  it('today being an unplanned (off) day does not break the streak', () => {
    const schedule: ScheduleDay[] = [
      studyDay('2026-09-10', ['a1']),
      studyDay('2026-09-11', ['b1']),
      bufferDay('2026-09-12'),
      studyDay('2026-09-13', ['c1']),
      studyDay('2026-09-14', ['d1']),
    ];
    const progress: ProgressStore = {
      ...watched('2026-09-10', ['a1']),
      ...watched('2026-09-11', ['b1']),
      ...watched('2026-09-13', ['c1']),
      ...watched('2026-09-14', ['d1']),
    };
    // 09-15 is not in the schedule at all (a Sunday): the streak carries on
    expect(computeStreak(progress, schedule, '2026-09-15')).toBe(4);
    // even a few days after the plan ends it keeps counting
    expect(computeStreak(progress, schedule, '2026-09-18')).toBe(4);
  });

  it('never counts days before the plan started', () => {
    const schedule: ScheduleDay[] = [studyDay('2026-09-10', ['a1']), studyDay('2026-09-11', ['b1'])];
    const progress: ProgressStore = {
      ...watched('2026-09-05', ['x1']), // before the plan: irrelevant
      ...watched('2026-09-10', ['a1']),
      ...watched('2026-09-11', ['b1']),
    };
    expect(computeStreak(progress, schedule, '2026-09-11')).toBe(2);
  });

  it('empty schedule or a future plan start -> 0', () => {
    expect(computeStreak({}, [], '2026-09-14')).toBe(0);
    expect(computeStreak(watched('2026-09-10', ['a']), [studyDay('2026-09-10', ['a'])], '2026-09-05')).toBe(0);
  });

  it('a study day whose lectures all dropped off the plan is skipped, not a break', () => {
    // No day entry at all for 09-11 (e.g. all lectures were pre-done): it is
    // simply not a planned study day.
    const schedule: ScheduleDay[] = [
      studyDay('2026-09-10', ['a1']),
      studyDay('2026-09-12', ['c1']),
      studyDay('2026-09-13', ['d1']),
    ];
    const progress: ProgressStore = {
      ...watched('2026-09-10', ['a1']),
      ...watched('2026-09-12', ['c1']),
      ...watched('2026-09-13', ['d1']),
    };
    expect(computeStreak(progress, schedule, '2026-09-13')).toBe(3);
  });
});
