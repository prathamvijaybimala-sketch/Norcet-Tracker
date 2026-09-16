import { describe, expect, it } from 'vitest';
import {
  generateSchedule,
  nextOffDayOnOrAfter,
  nextStudyDateOnOrAfter,
} from '../src/lib/schedule';
import { makePlan, makeSubjects, hours } from './helpers';
import { dateRange, weekdayOf } from '../src/lib/dates';
import type { PlanConfig, ScheduleDay } from '../src/types';

const START = '2026-09-15'; // a Tuesday

function outline(schedule: ScheduleDay[]): string[] {
  return schedule.map((d) => `${d.date}:${d.type}:${d.lectureIds.length}`);
}

/** Sixteen one-hour lectures = 5.33 days of a 3h day. */
const BIG = hours('A', ...Array.from({ length: 16 }, () => 1));

describe('regression: off days follow the chosen study days', () => {
  it('with Mon-Sat study days, structural off days are Sundays only', () => {
    const subjects = makeSubjects([BIG]);
    const schedule = generateSchedule(
      subjects,
      makePlan({ subjectOrder: [subjects[0].id], studyDays: [1, 2, 3, 4, 5, 6] }),
      {},
    );
    expect(schedule.length).toBeGreaterThanOrEqual(7);
    for (const d of schedule) {
      if (d.type === 'off') expect(weekdayOf(d.date)).toBe(0);
    }
  });
});

describe('date helpers', () => {
  const cfg = makePlan({ studyDays: [1, 2, 3, 4, 5, 6] }); // Mon-Sat
  it('nextOffDayOnOrAfter finds the following Sunday', () => {
    expect(nextOffDayOnOrAfter('2026-09-15', cfg)).toBe('2026-09-20');
    // When today is already the off day, it is returned as-is.
    expect(nextOffDayOnOrAfter('2026-09-20', cfg)).toBe('2026-09-20');
  });
  it('nextStudyDateOnOrAfter skips the off day and leave days', () => {
    expect(nextStudyDateOnOrAfter('2026-09-15', cfg)).toBe('2026-09-15');
    expect(nextStudyDateOnOrAfter('2026-09-20', cfg)).toBe('2026-09-21');
    const withLeave = { ...cfg, leaveDates: ['2026-09-21'] };
    expect(nextStudyDateOnOrAfter('2026-09-21', withLeave)).toBe('2026-09-22');
  });

  it('dateRange rejects invalid endpoints instead of looping to the cap', () => {
    // A cleared date input yields "" - this used to run 20,000 iterations and
    // return thousands of NaN-dates, which then became "leave days".
    expect(dateRange('', '2026-09-20')).toEqual([]);
    expect(dateRange('2026-09-15', '')).toEqual([]);
    expect(dateRange('not-a-date', '2026-09-20')).toEqual([]);
    // Valid input still works.
    expect(dateRange('2026-09-18', '2026-09-20')).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
  });
});

describe('backlog: move to off day', () => {
  it('places the moved lecture on its off day as a study day, out of the queue', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1)]);
    const id = subjects[0].topics[0].lectures[0].id;
    const config: PlanConfig = {
      ...makePlan({
        subjectOrder: [subjects[0].id],
        studyDays: [1, 2, 3, 4, 5, 6],
        dailyHours: 3,
        playbackSpeed: 1,
      }),
      offDayLectures: { [id]: '2026-09-20' },
    };
    const schedule = generateSchedule(subjects, config, {});
    const sunday = schedule.find((d) => d.date === '2026-09-20');
    expect(sunday?.type).toBe('study');
    expect(sunday?.lectureIds).toEqual([id]);
    // The remaining three lectures pack normally from the start date.
    expect(schedule.find((d) => d.date === START)?.lectureIds).toHaveLength(3);
    // No lecture lost: 3 + 1.
    expect(schedule.reduce((n, d) => n + d.lectureIds.length, 0)).toBe(4);
  });

  it('a watched off-day lecture drops its off-day slot', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1)]);
    const id = subjects[0].topics[0].lectures[0].id;
    const config: PlanConfig = {
      ...makePlan({
        subjectOrder: [subjects[0].id],
        studyDays: [1, 2, 3, 4, 5, 6],
        dailyHours: 3,
        playbackSpeed: 1,
      }),
      offDayLectures: { [id]: '2026-09-20' },
    };
    const progress = {
      [id]: {
        lectureId: id,
        lectureWatched: true,
        notesDone: false,
        questionsDone: false,
        completedDate: '2026-09-20',
      },
    };
    const schedule = generateSchedule(subjects, config, progress);
    // The Sunday slot vanishes; only the two remaining lectures stay.
    expect(schedule.find((d) => d.date === '2026-09-20')).toBeUndefined();
    expect(schedule.reduce((n, d) => n + d.lectureIds.length, 0)).toBe(2);
  });

  it('several lectures can share one off day', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1)]);
    const [a, b, c] = subjects[0].topics[0].lectures;
    const config: PlanConfig = {
      ...makePlan({
        subjectOrder: [subjects[0].id],
        studyDays: [1, 2, 3, 4, 5, 6],
        dailyHours: 3,
        playbackSpeed: 1,
      }),
      offDayLectures: { [a.id]: '2026-09-20', [b.id]: '2026-09-20' },
    };
    const schedule = generateSchedule(subjects, config, {});
    const sunday = schedule.find((d) => d.date === '2026-09-20');
    expect(sunday?.lectureIds.sort()).toEqual([a.id, b.id].sort());
    expect(schedule.find((d) => d.date === START)?.lectureIds).toEqual([c.id]);
  });
});

describe('backlog: shift the schedule (backlogAnchor)', () => {
  it('opens the first off day after the anchor as an overflow study day', () => {
    const subjects = makeSubjects([BIG]);
    const base: PlanConfig = {
      ...makePlan({
        subjectOrder: [subjects[0].id],
        studyDays: [1, 2, 3, 4, 5, 6],
        dailyHours: 3,
        playbackSpeed: 1,
      }),
    };

    // 16 lectures: without the anchor the 16th lands on Monday 21st...
    const plain = generateSchedule(subjects, base, {});
    expect(outline(plain)).toEqual([
      '2026-09-15:study:3',
      '2026-09-16:study:3',
      '2026-09-17:study:3',
      '2026-09-18:study:3',
      '2026-09-19:study:3',
      '2026-09-20:off:0',
      '2026-09-21:study:1',
    ]);

    // ...with the anchor, the following Sunday 20th absorbs it instead.
    const shifted = generateSchedule(subjects, { ...base, backlogAnchor: '2026-09-15' }, {});
    expect(outline(shifted)).toEqual([
      '2026-09-15:study:3',
      '2026-09-16:study:3',
      '2026-09-17:study:3',
      '2026-09-18:study:3',
      '2026-09-19:study:3',
      '2026-09-20:study:1',
    ]);
  });

  it('leaves the off day untouched when the plan finishes before it', () => {
    const subjects = makeSubjects([hours('A', 1)]);
    const config: PlanConfig = {
      ...makePlan({
        subjectOrder: [subjects[0].id],
        studyDays: [1, 2, 3, 4, 5, 6],
        dailyHours: 3,
        playbackSpeed: 1,
      }),
      backlogAnchor: '2026-09-15',
    };
    const schedule = generateSchedule(subjects, config, {});
    expect(outline(schedule)).toEqual(['2026-09-15:study:1']);
  });

  it('an anchor older than the start date is ignored', () => {
    const subjects = makeSubjects([BIG]);
    const config: PlanConfig = {
      ...makePlan({
        subjectOrder: [subjects[0].id],
        studyDays: [1, 2, 3, 4, 5, 6],
        dailyHours: 3,
        playbackSpeed: 1,
        startDate: '2026-09-18',
      }),
      backlogAnchor: '2026-09-15',
    };
    const schedule = generateSchedule(subjects, config, {});
    // The overflow day would have been Sep 20, but the anchor predates the
    // start, so it is not active: the 16th lecture lands on Monday 21st.
    expect(schedule[schedule.length - 1].date).toBe('2026-09-24');
  });
});
