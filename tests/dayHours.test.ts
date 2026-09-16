/**
 * Per-day hours override (the Today screen's "Today: Xh" slider).
 *
 * The override is a SOFT, week-scoped RE-PACK: the whole week is re-packed
 * around the new hours (week's lecture pool, subject runs preserved, whole
 * lectures only):
 *  - a reduced day leaves the week with a tail that rides onto the week's
 *    off day (dropped to the Backlog tab when the plan has no off day);
 *  - an increased day leaves the week's later days lighter (capped at zero);
 *  - next week - and everything outside the week - is untouched.
 *
 * Fixture: one subject, one topic, 45-minute lectures at 1x speed, 3h/day
 * (4 lectures per study day), Mon-Sat study days, Sunday off. Week starts
 * Monday 2026-09-14, so: Mon 14 .. Sat 19 is week one, Sunday 20 is its off
 * day, Monday 21 starts week two.
 */
import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../src/lib/schedule';
import { parseCurriculumJSON } from '../src/lib/parseCurriculum';
import { defaultPlanConfig } from '../src/lib/exportImport';
import type { PlanConfig, ProgressStore, ScheduleDay, Subject } from '../src/types';

const START = '2026-09-14'; // a Monday
const MON1 = '2026-09-14';
const TUE1 = '2026-09-15';
const WED1 = '2026-09-16';
const THU1 = '2026-09-17';
const FRI1 = '2026-09-18';
const SAT1 = '2026-09-19';
const SUN1 = '2026-09-20';
const MON2 = '2026-09-21';
const TUE2 = '2026-09-22';

/** Lecture ids are sequential: L1..Ln -> 'subject-a__topic-a__lecture-N'. */
const L = (n: number) => `subject-a__topic-a__lecture-${n}`;

function makeCurriculum(n: number): Subject[] {
  const subtopics = Array.from({ length: n }, (_, i) => ({
    name: `Lecture ${i + 1}`,
    duration: '00:45:00',
  }));
  const raw = JSON.stringify({
    'Subject A': { instructor: 'Dr X', topics: [{ topic: 'Topic A', subtopics }] },
  });
  return parseCurriculumJSON(raw);
}

function makePlan(
  dayHours: Record<string, number>,
  curriculumIds: string[],
  studyDays = [1, 2, 3, 4, 5, 6],
  extra: Partial<PlanConfig> = {},
): PlanConfig {
  const plan = defaultPlanConfig(START, curriculumIds);
  plan.studyDays = studyDays;
  plan.dailyHours = 3;
  plan.playbackSpeed = 1;
  plan.dayHours = dayHours;
  return { ...plan, ...extra };
}

const byDate = (schedule: ScheduleDay[]) => new Map(schedule.map((d) => [d.date, d]));
const ids = (map: Map<string, ScheduleDay>, date: string) => map.get(date)?.lectureIds ?? [];
const total = (schedule: ScheduleDay[]) => schedule.reduce((n, d) => n + d.lectureIds.length, 0);

/** Next week (and everything outside the week) must be byte-identical. */
function expectNextWeekUnchanged(base: ScheduleDay[], next: ScheduleDay[]) {
  const b = byDate(base);
  const n = byDate(next);
  for (const date of [MON2, TUE2]) {
    expect(ids(n, date), `day ${date} must be unchanged`).toEqual(ids(b, date));
  }
}

describe('applyDayHourOverrides via generateSchedule', () => {
  it('reducing a mid-week day rides the shortfall onto the week\'s off day (Sunday)', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 2 }, planIds), {});

    const n = byDate(next);

    // Wednesday (3h -> 2h) keeps its first two 45-min lectures...
    expect(ids(n, WED1)).toEqual([L(9), L(10)]);
    // ...and the tail (the two lectures that no longer fit) rides onto Sunday.
    expect(n.get(SUN1)?.type).toBe('study');
    expect(ids(n, SUN1)).toEqual([L(23), L(24)]);
    // The re-packed days keep the plan's order and load, next week untouched.
    expect(ids(n, MON1)).toEqual([L(1), L(2), L(3), L(4)]);
    expect(ids(n, TUE1)).toEqual([L(5), L(6), L(7), L(8)]);
    expect(total(next)).toBe(total(base));
    expectNextWeekUnchanged(base, next);
  });

  it('increasing a mid-week day reflows the week: later days get lighter, capped at zero', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 4 }, planIds), {});

    const n = byDate(next);

    // Wednesday (3h -> 4h) takes five; the week's pool (24 lectures) then
    // ends on Saturday with three, so Saturday is lighter by one.
    expect(ids(n, WED1)).toEqual([L(9), L(10), L(11), L(12), L(13)]);
    expect(n.get(WED1)?.plannedSec).toBe(5 * 45 * 60);
    expect(ids(n, SAT1)).toEqual([L(22), L(23), L(24)]);
    // The whole week still holds exactly its 24 lectures, in order...
    const week = [MON1, TUE1, WED1, THU1, FRI1, SAT1].map((d) => ids(n, d)).flat();
    expect(week).toEqual(Array.from({ length: 24 }, (_, i) => L(i + 1)));
    // ...no week day exceeds its capacity, and nothing sits on Sunday.
    const cap = (date: string) => Math.round((date === WED1 ? 4 : 3) * 3600);
    for (const date of [MON1, TUE1, WED1, THU1, FRI1, SAT1]) {
      expect(n.get(date)?.plannedSec, date).toBeLessThanOrEqual(cap(date));
    }
    expect(ids(n, SUN1)).toEqual([]);
    // Next week is untouched - nothing was pulled from it.
    expect(total(next)).toBe(total(base));
    expectNextWeekUnchanged(base, next);
  });

  it('an increase that the week\'s pool cannot fill empties the tail days (capped at zero)', () => {
    // 22 lectures: the base plan ends mid-Saturday (Sat carries two).
    const curriculum = makeCurriculum(22);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    // Wednesday -> 5h: the re-packed week holds all 22 by Friday.
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 5 }, planIds), {});

    const n = byDate(next);

    // Wednesday takes six (270 min <= 5h)...
    expect(ids(n, WED1)).toEqual([L(9), L(10), L(11), L(12), L(13), L(14)]);
    expect(n.get(WED1)?.plannedSec).toBe(6 * 45 * 60);
    // ...and Saturday empties out entirely (no negative load, day becomes off).
    expect(n.get(SAT1)?.lectureIds).toEqual([]);
    expect(n.get(SAT1)?.type).toBe('off');
    expect(total(next)).toBe(total(base));
    expectNextWeekUnchanged(base, next);
  });

  it('increasing the week\'s LAST study day is a no-op (nothing left to give)', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [SAT1]: 4 }, planIds), {});
    expect(next).toEqual(base);
  });

  it('reducing on a 7-days-a-week plan (no off day) drops the tail to the backlog', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const studyDays = [0, 1, 2, 3, 4, 5, 6];
    const base = generateSchedule(curriculum, makePlan({}, planIds, studyDays), {});
    const next = generateSchedule(
      curriculum,
      makePlan({ [WED1]: 2 }, planIds, studyDays),
      {},
    );

    const n = byDate(next);

    // Wednesday keeps two; the week reflows and ends Friday's... (Sunday)
    // with six lectures short of the pool - with no off day, the two that
    // no longer fit are DROPPED: unwatched and unscheduled (the Backlog tab
    // lists them as missed).
    expect(ids(n, WED1)).toEqual([L(9), L(10)]);
    const all = next.flatMap((d) => d.lectureIds);
    expect(all).not.toContain(L(27));
    expect(all).not.toContain(L(28));
    expect(all).toHaveLength(total(base) - 2);
    // Next week still gets its lectures in the right order.
    expect(ids(n, MON2)).toEqual(ids(byDate(base), MON2));
  });

  it('two reductions in the same week both land on the off day, in date order', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(
      curriculum,
      makePlan({ [WED1]: 2, [FRI1]: 2 }, planIds),
      {},
    );

    const n = byDate(next);

    expect(ids(n, WED1)).toEqual([L(9), L(10)]);
    expect(ids(n, FRI1)).toEqual([L(15), L(16)]);
    // The re-packed week ends on Friday with four lectures short; Sunday
    // carries exactly that tail.
    expect(ids(n, SUN1)).toEqual([L(21), L(22), L(23), L(24)]);
    expect(total(next)).toBe(total(base));
    expectNextWeekUnchanged(base, next);
  });

  it('an override acts on the week\'s current (repacked) lectures and never resurrects watched ones', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    // Watch all of Monday's lectures: later lectures pull forward into the
    // freed slots (the schedule is compacted), so every day still carries 4.
    const watched = new Set(ids(byDate(base), MON1));
    const progress: ProgressStore = {};
    for (const id of watched) {
      progress[id] = {
        lectureId: id,
        lectureWatched: true,
        notesDone: true,
        questionsDone: false,
        completedDate: MON1,
      };
    }
    const repacked = generateSchedule(curriculum, makePlan({}, planIds), progress);
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 2 }, planIds), progress);

    const n = byDate(next);
    // Wednesday keeps its CURRENT (repacked) first two lectures; the week's
    // tail rides onto Sunday, exactly as on a fresh plan.
    expect(ids(n, WED1)).toEqual([L(13), L(14)]);
    expect(ids(n, SUN1)).toEqual([L(27), L(28)]);
    // No watched lecture ever comes back into the schedule.
    for (const day of next) {
      for (const id of day.lectureIds) expect(watched.has(id), id).toBe(false);
    }
    // Week two is untouched.
    expect(ids(n, MON2)).toEqual(ids(byDate(repacked), MON2));
    expect(total(next)).toBe(total(repacked));
  });

  it('keeps subject runs intact when the reduced day is a subject\'s first day', () => {
    // Subject A (8 lectures) fills Mon-Tue; subject B (24) starts Wednesday.
    const makeTwoSubjects = (): Subject[] => {
      const raw = JSON.stringify({
        'Subject A': {
          instructor: 'Dr X',
          topics: [
            {
              topic: 'Topic A',
              subtopics: Array.from({ length: 8 }, (_, i) => ({
                name: `A${i + 1}`,
                duration: '00:45:00',
              })),
            },
          ],
        },
        'Subject B': {
          instructor: 'Dr Y',
          topics: [
            {
              topic: 'Topic B',
              subtopics: Array.from({ length: 24 }, (_, i) => ({
                name: `B${i + 1}`,
                duration: '00:45:00',
              })),
            },
          ],
        },
      });
      return parseCurriculumJSON(raw);
    };
    const curriculum = makeTwoSubjects();
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 2 }, planIds), {});

    const b = byDate(base);
    const n = byDate(next);
    const bA = [...ids(b, MON1), ...ids(b, TUE1)]; // A1..A8
    const bB = ids(b, WED1); // B1..B4

    // Subject A's days are untouched...
    expect(ids(n, MON1)).toEqual(bA.slice(0, 4));
    expect(ids(n, TUE1)).toEqual(bA.slice(4));
    // ...Wednesday (B's first day, 3h -> 2h) keeps its first two, and the
    // reflow shifts B's remaining lectures across Thu-Sat...
    expect(ids(n, WED1)).toEqual(bB.slice(0, 2));
    // ...with B's tail riding onto Sunday - A's lectures never cross over.
    expect(ids(n, SUN1)).toEqual([
      `${planIds[1]}__topic-b__b15`,
      `${planIds[1]}__topic-b__b16`,
    ]);
    for (const date of [WED1, THU1, FRI1, SAT1, SUN1]) {
      for (const id of ids(n, date)) expect(id.startsWith(planIds[0] + '__')).toBe(false);
    }
    expect(total(next)).toBe(total(base));
    expectNextWeekUnchanged(base, next);
  });

  it('leaves lectures parked on an off day (Backlog) exactly where they are', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    // Park Saturday's last lecture on the off day (as "To (off day)" does).
    const parked: Record<string, string> = { [L(24)]: SUN1 };
    const base = generateSchedule(
      curriculum,
      makePlan({}, planIds, [1, 2, 3, 4, 5, 6], { offDayLectures: parked }),
      {},
    );
    const next = generateSchedule(
      curriculum,
      makePlan({ [WED1]: 2 }, planIds, [1, 2, 3, 4, 5, 6], { offDayLectures: parked }),
      {},
    );

    const n = byDate(next);

    // The parked lecture keeps its off-day slot...
    expect(ids(n, SUN1)).toContain(L(24));
    // ...and the reflowed tail rides onto the SAME day, next to it.
    expect(ids(n, SUN1)).toContain(L(23));
    // Nothing is lost or duplicated.
    expect(next.flatMap((d) => d.lectureIds)).toHaveLength(32);
    expect(new Set(next.flatMap((d) => d.lectureIds))).toHaveLength(32);
    // The parked lecture was NOT reflowed into the week's study days.
    const week = [MON1, TUE1, WED1, THU1, FRI1, SAT1].map((d) => ids(n, d)).flat();
    expect(week).not.toContain(L(24));
    expectNextWeekUnchanged(base, next);
  });
});
