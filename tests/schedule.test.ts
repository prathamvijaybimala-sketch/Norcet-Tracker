import { describe, expect, it } from 'vitest';
import { generateSchedule, catchUpPlan, lastStudyDate } from '../src/lib/schedule';
import { makePlan, makeSubjects, hours, watched } from './helpers';
import type { PlanConfig, ScheduleDay } from '../src/types';

const START = '2026-09-15'; // a Tuesday

function plan(overrides: Partial<PlanConfig> = {}): PlanConfig {
  return makePlan({ startDate: START, ...overrides });
}

/** Compact view for assertions: "date:type:lectureCount". */
function outline(schedule: ScheduleDay[]): string[] {
  return schedule.map((d) => `${d.date}:${d.type}:${d.lectureIds.length}`);
}

describe('generateSchedule', () => {
  it('1. empty curriculum -> empty schedule, no crash', () => {
    expect(generateSchedule([], plan(), {})).toEqual([]);
  });

  it('1b. degenerate configs never hang', () => {
    const subjects = makeSubjects([hours('A', 1)]);
    const order = [subjects[0].id];
    expect(generateSchedule(subjects, plan({ subjectOrder: order, studyDays: [] }), {})).toEqual([]);
    expect(generateSchedule(subjects, plan({ subjectOrder: order, dailyHours: 0 }), {})).toEqual([]);
    expect(generateSchedule(subjects, plan({ subjectOrder: [] }), {})).toEqual([]);
  });

  it('2. single subject, single lecture shorter than daily capacity -> 1 study day', () => {
    const subjects = makeSubjects([hours('A', 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({ subjectOrder: [subjects[0].id], dailyHours: 3, playbackSpeed: 1 }),
      {},
    );
    expect(schedule).toHaveLength(1);
    expect(schedule[0]).toMatchObject({ date: START, type: 'study', lectureIds: [expect.any(String)] });
  });

  it('3. uneven division -> last day under-filled, never overflowing', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1, 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({ subjectOrder: [subjects[0].id], dailyHours: 3, playbackSpeed: 1 }),
      {},
    );
    expect(outline(schedule)).toEqual([`${START}:study:3`, '2026-09-16:study:2']);
    // 3h day = 10800s; the second day only carries 7200s.
    expect(schedule[1].plannedSec).toBeLessThan(3 * 3600);
  });

  it('3b. a lecture is never split across two days', () => {
    // Two 2h lectures with a 3h/day budget: each needs a whole day.
    const subjects = makeSubjects([hours('A', 2, 2)]);
    const schedule = generateSchedule(
      subjects,
      plan({ subjectOrder: [subjects[0].id], dailyHours: 3, playbackSpeed: 1 }),
      {},
    );
    expect(outline(schedule)).toEqual([`${START}:study:1`, '2026-09-16:study:1']);
  });

  it('4. a fully completed subject contributes zero days AND zero buffer', () => {
    const subjects = makeSubjects([hours('A', 1, 1), hours('B', 1)]);
    const progress = watched(subjects, (name) => name === 'A');
    const schedule = generateSchedule(
      subjects,
      plan({
        subjectOrder: subjects.map((s) => s.id),
        dailyHours: 3,
        playbackSpeed: 1,
        bufferDaysBySubject: { [subjects[0].id]: 10, [subjects[1].id]: 10 },
      }),
      progress,
    );
    // Only B remains: one study day + its 10 buffer days = 11 days.
    expect(schedule.filter((d) => d.type === 'study')).toHaveLength(1);
    expect(schedule.filter((d) => d.type === 'buffer')).toHaveLength(10);
    expect(schedule).toHaveLength(11);
    expect(schedule.every((d) => d.subjectId === subjects[1].id)).toBe(true);
  });

  it('5. leave days push lectures to the next available study day', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1, 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({
        subjectOrder: [subjects[0].id],
        dailyHours: 3,
        playbackSpeed: 1,
        studyDays: [0, 1, 2, 3, 4, 5, 6],
        leaveDates: ['2026-09-16'],
      }),
      {},
    );
    expect(outline(schedule)).toEqual([
      `${START}:study:3`,
      '2026-09-16:off:0',
      '2026-09-17:study:2',
    ]);
    const offDay = schedule[1];
    expect(offDay.isLeaveDay).toBe(true);
    expect(offDay.type).toBe('off');
  });

  it('5b. non-study weekdays appear as off days', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({ subjectOrder: [subjects[0].id], dailyHours: 3, playbackSpeed: 1, studyDays: [1, 2, 3, 4, 5] }),
      {},
    );
    // Tue 15 + Wed 16 (3 lectures), Thu 17 (1 lecture), then Fri 18 = off,
    // Sat/Sun off, Mon 21 = off... no: only 4 lectures, so it ends Thu 17.
    expect(outline(schedule)).toEqual([`${START}:study:3`, '2026-09-16:study:1']);
  });

  it('6. reordering subjects shifts future days only; completed lectures stay done', () => {
    const subjects = makeSubjects([hours('A', 1), hours('B', 1)]);
    const [a, b] = subjects;
    const base = { dailyHours: 3, playbackSpeed: 1, studyDays: [0, 1, 2, 3, 4, 5, 6] };

    const ab = generateSchedule(subjects, plan({ ...base, subjectOrder: [a.id, b.id] }), {});
    const ba = generateSchedule(subjects, plan({ ...base, subjectOrder: [b.id, a.id] }), {});
    expect(ab[0].subjectId).toBe(a.id);
    expect(ba[0].subjectId).toBe(b.id);

    // With A's lecture already watched, both orders contain only B's lecture,
    // and it lands on the start date in either order.
    const progress = watched(subjects, (name) => name === 'A');
    const abDone = generateSchedule(subjects, plan({ ...base, subjectOrder: [a.id, b.id] }), progress);
    const baDone = generateSchedule(subjects, plan({ ...base, subjectOrder: [b.id, a.id] }), progress);
    expect(abDone).toHaveLength(1);
    expect(baDone).toHaveLength(1);
    expect(abDone[0].lectureIds).toEqual(baDone[0].lectureIds);
    expect(abDone[0].date).toBe(START);
    // Completed work is untouched by the reorder.
    expect(Object.keys(progress)).toHaveLength(1);
  });

  it('7a. buffer days count through off days by default (3 days = 3 calendar days)', () => {
    // Thu 17 Sep: one lecture day, then a 3 day buffer spanning Fri/Sat/Sun.
    const subjects = makeSubjects([hours('A', 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({
        subjectOrder: [subjects[0].id],
        startDate: '2026-09-17',
        dailyHours: 3,
        playbackSpeed: 1,
        studyDays: [1, 2, 3, 4, 5], // Mon-Fri
        bufferDaysBySubject: { [subjects[0].id]: 3 },
        bufferCountsOffDays: true,
      }),
      {},
    );
    expect(outline(schedule)).toEqual([
      '2026-09-17:study:1',
      '2026-09-18:buffer:0',
      '2026-09-19:buffer:0',
      '2026-09-20:buffer:0',
    ]);
  });

  it('7b. with bufferCountsOffDays=false the buffer skips weekends and leave days', () => {
    const subjects = makeSubjects([hours('A', 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({
        subjectOrder: [subjects[0].id],
        startDate: '2026-09-17',
        dailyHours: 3,
        playbackSpeed: 1,
        studyDays: [1, 2, 3, 4, 5], // Mon-Fri
        bufferDaysBySubject: { [subjects[0].id]: 3 },
        bufferCountsOffDays: false,
      }),
      {},
    );
    // Fri 18 is a buffer day, Sat/Sun are off, Mon 20 + Tue 21 are buffer days.
    expect(outline(schedule)).toEqual([
      '2026-09-17:study:1',
      '2026-09-18:buffer:0',
      '2026-09-19:off:0',
      '2026-09-20:off:0',
      '2026-09-21:buffer:0',
      '2026-09-22:buffer:0',
    ]);
    expect(schedule.filter((d) => d.type === 'buffer')).toHaveLength(3);
  });

  it('8. effective duration accounts for playback speed', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1)]); // 3 raw hours
    const schedule = generateSchedule(
      subjects,
      plan({
        subjectOrder: [subjects[0].id],
        dailyHours: 1,
        playbackSpeed: 1.5,
        studyDays: [0, 1, 2, 3, 4, 5, 6],
      }),
      {},
    );
    // 1h at 1.5x = 40 min; a 1h day fits exactly one lecture (80 min would not).
    expect(outline(schedule)).toEqual([
      `${START}:study:1`,
      '2026-09-16:study:1',
      '2026-09-17:study:1',
    ]);
  });

  it('9. excluded subjects never appear in the schedule', () => {
    const subjects = makeSubjects([hours('A', 1), hours('B', 1)]);
    const schedule = generateSchedule(
      subjects,
      plan({ subjectOrder: [subjects[1].id], dailyHours: 3, playbackSpeed: 1 }),
      {},
    );
    expect(schedule).toHaveLength(1);
    expect(schedule[0].subjectId).toBe(subjects[1].id);
  });

  it('10. performance: 1000 lectures regenerate well under 50ms', () => {
    const lectures = Array.from({ length: 1000 }, () => 2400);
    const subjects = makeSubjects([{ name: 'Big', topics: [{ name: 'T', lectures }] }]);
    const config = plan({
      subjectOrder: [subjects[0].id],
      dailyHours: 3,
      playbackSpeed: 1.5,
      bufferDaysBySubject: { [subjects[0].id]: 5 },
    });
    // Warm up, then measure 20 consecutive regenerations (the worst case: a
    // checkbox tick on a full curriculum).
    generateSchedule(subjects, config, {});
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) generateSchedule(subjects, config, {});
    const perCall = (performance.now() - t0) / 20;
    expect(perCall).toBeLessThan(50);
  });
});

describe('catchUpPlan', () => {
  it('moves the start date to today and drops past leave days', () => {
    const config = plan({ startDate: '2026-09-01', leaveDates: ['2026-09-05', '2026-10-10'] });
    const next = catchUpPlan(config, '2026-09-20');
    expect(next.startDate).toBe('2026-09-20');
    expect(next.leaveDates).toEqual(['2026-10-10']);
  });

  it('is a no-op when the plan already starts today or later', () => {
    const config = plan({ startDate: '2026-09-20' });
    expect(catchUpPlan(config, '2026-09-20')).toBe(config);
    expect(catchUpPlan(config, '2026-09-01')).toBe(config);
  });

  it('reflows backlog lectures into today', () => {
    const subjects = makeSubjects([hours('A', 1, 1, 1, 1)]);
    const config = plan({
      subjectOrder: [subjects[0].id],
      startDate: '2026-09-01',
      dailyHours: 3,
      playbackSpeed: 1,
      studyDays: [0, 1, 2, 3, 4, 5, 6],
    });
    // Nothing done: the plan is sitting entirely in the past.
    const before = generateSchedule(subjects, config, {});
    expect(before[before.length - 1].date).toBe('2026-09-02');

    const caughtUp = generateSchedule(subjects, catchUpPlan(config, '2026-09-17'), {});
    expect(caughtUp[0].date).toBe('2026-09-17');
    expect(lastStudyDate(caughtUp)).toBe('2026-09-18');
  });
});
