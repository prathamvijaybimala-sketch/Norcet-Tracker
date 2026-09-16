/**
 * Per-day hours override (the Today screen's "Today: Xh" slider).
 *
 * The override is a SOFT, week-scoped rebalance:
 *  - reducing a day moves the no-longer-fitting tail (whole lectures) onto
 *    that week's off day (the same overflow day the Backlog feature uses);
 *  - increasing a day pulls the matching tail off the week's LAST study day;
 *  - everything else - and especially next week - is untouched.
 *
 * Fixture: one subject, one topic, 45-minute lectures at 1x speed, 3h/day
 * (4 lectures per day), Mon-Sat study days, Sunday off. Week starts Monday
 * 2026-09-14, so: Mon 14 .. Sat 19 is week one, Sunday 20 is its off day,
 * Monday 21 starts week two.
 */
import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../src/lib/schedule';
import { parseCurriculumJSON } from '../src/lib/parseCurriculum';
import { defaultPlanConfig } from '../src/lib/exportImport';
import type { ProgressStore, ScheduleDay } from '../src/types';

const START = '2026-09-14'; // a Monday
const MON1 = '2026-09-14';
const WED1 = '2026-09-16';
const FRI1 = '2026-09-18';
const SAT1 = '2026-09-19';
const SUN1 = '2026-09-20';
const MON2 = '2026-09-21';
const TUE2 = '2026-09-22';

function makeCurriculum(n: number) {
  const subtopics = Array.from({ length: n }, (_, i) => ({
    name: `Lecture ${i + 1}`,
    duration: '00:45:00',
  }));
  const raw = JSON.stringify({
    'Subject A': { instructor: 'Dr X', topics: [{ topic: 'Topic A', subtopics }] },
  });
  return parseCurriculumJSON(raw);
}

function makePlan(dayHours: Record<string, number>, curriculumIds: string[], studyDays = [1, 2, 3, 4, 5, 6]) {
  const plan = defaultPlanConfig(START);
  plan.subjectOrder = curriculumIds;
  plan.studyDays = studyDays;
  plan.dailyHours = 3;
  plan.playbackSpeed = 1;
  plan.dayHours = dayHours;
  return plan;
}

const byDate = (schedule: ScheduleDay[]) => new Map(schedule.map((d) => [d.date, d]));
const ids = (map: Map<string, ScheduleDay>, date: string) => map.get(date)?.lectureIds ?? [];

/** Every day EXCEPT the listed ones must be identical between the two runs. */
function assertOtherDaysUnchanged(base: ScheduleDay[], next: ScheduleDay[], except: string[]) {
  const b = byDate(base);
  const n = byDate(next);
  for (const [date, day] of b) {
    if (except.includes(date)) continue;
    expect(ids(n, date), `day ${date} must be unchanged`).toEqual(day.lectureIds);
    expect(day.plannedSec).toBe(n.get(date)?.plannedSec);
  }
  // No surprise new days elsewhere.
  for (const date of n.keys()) {
    if (!b.has(date) && !except.includes(date)) {
      throw new Error(`unexpected new day ${date}`);
    }
  }
}

describe('applyDayHourOverrides via generateSchedule', () => {
  it('reducing a mid-week day rides the shortfall onto the week\'s off day (Sunday)', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 2 }, planIds), {});

    const b = byDate(base);
    const n = byDate(next);

    // Wednesday (3h -> 2h) keeps its first two 45-min lectures...
    expect(ids(n, WED1)).toHaveLength(2);
    expect(ids(n, WED1)).toEqual(ids(b, WED1).slice(0, 2));
    // ...and the tail (the two lectures that no longer fit) rides onto Sunday.
    const sun = n.get(SUN1);
    expect(sun?.type).toBe('study');
    expect(sun?.lectureIds).toEqual(ids(b, WED1).slice(2));
    // Everything else - including the whole of next week - is untouched.
    assertOtherDaysUnchanged(base, next, [WED1, SUN1]);
    expect(ids(n, MON2)).toEqual(ids(b, MON2));
    expect(ids(n, TUE2)).toEqual(ids(b, TUE2));
  });

  it('increasing a mid-week day pulls the tail off the week\'s last study day (Saturday)', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 4 }, planIds), {});

    const b = byDate(base);
    const n = byDate(next);

    // Wednesday (3h -> 4h): its own four lectures PLUS Saturday's last two.
    const baseWed = ids(b, WED1);
    const baseSat = ids(b, SAT1);
    expect(ids(n, WED1)).toEqual([...baseWed, ...baseSat.slice(-2)]);
    // Saturday is lighter by exactly the pulled lectures (capped at its load).
    expect(ids(n, SAT1)).toEqual(baseSat.slice(0, -2));
    // No negative loads anywhere, and next week is untouched.
    for (const [date, day] of n) expect(day.plannedSec, date).toBeGreaterThanOrEqual(0);
    assertOtherDaysUnchanged(base, next, [WED1, SAT1]);
    expect(ids(n, MON2)).toEqual(ids(b, MON2));
  });

  it('increase larger than the last day\'s load caps there (day may empty, never negative)', () => {
    // 22 lectures: Saturday only carries two (90 min).
    const curriculum = makeCurriculum(22);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    // Wednesday -> 5h: a 2h (120 min) surplus, but Saturday only has 90 min.
    const next = generateSchedule(curriculum, makePlan({ [WED1]: 5 }, planIds), {});

    const b = byDate(base);
    const n = byDate(next);

    expect(ids(b, SAT1)).toHaveLength(2);
    // The pull is capped at Saturday's whole load: Saturday empties...
    expect(ids(n, SAT1)).toEqual([]);
    expect(n.get(SAT1)?.plannedSec).toBe(0);
    // ...and Wednesday takes everything (4 + 2 = 6 x 45 min = 270 min <= 5h).
    expect(ids(n, WED1)).toHaveLength(6);
    expect(n.get(WED1)?.plannedSec).toBe(6 * 45 * 60);
    assertOtherDaysUnchanged(base, next, [WED1, SAT1]);
  });

  it('increasing the week\'s LAST study day is a no-op (nothing left to absorb it)', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const base = generateSchedule(curriculum, makePlan({}, planIds), {});
    const next = generateSchedule(curriculum, makePlan({ [SAT1]: 4 }, planIds), {});
    expect(next).toEqual(base);
  });

  it('reducing on a 7-days-a-week plan (no off day) is a no-op', () => {
    const curriculum = makeCurriculum(32);
    const planIds = curriculum.map((s) => s.id);
    const studyDays = [0, 1, 2, 3, 4, 5, 6];
    const base = generateSchedule(curriculum, makePlan({}, planIds, studyDays), {});
    const next = generateSchedule(
      curriculum,
      makePlan({ [WED1]: 2 }, planIds, studyDays),
      {},
    );
    expect(next).toEqual(base);
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

    const b = byDate(base);
    const n = byDate(next);

    expect(ids(n, WED1)).toEqual(ids(b, WED1).slice(0, 2));
    expect(ids(n, FRI1)).toEqual(ids(b, FRI1).slice(0, 2));
    // Sunday carries both tails (Wednesday's first, then Friday's).
    expect(ids(n, SUN1)).toEqual([
      ...ids(b, WED1).slice(2),
      ...ids(b, FRI1).slice(2),
    ]);
    assertOtherDaysUnchanged(base, next, [WED1, FRI1, SUN1]);
  });

  it('an override acts on the day\'s current (repacked) lectures and never resurrects watched ones', () => {
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

    const b = byDate(repacked);
    const n = byDate(next);
    // Wednesday keeps its CURRENT (repacked) first two lectures; the tail
    // rides onto Sunday, exactly as on a fresh plan.
    const wed = ids(b, WED1);
    expect(wed).toHaveLength(4);
    expect(ids(n, WED1)).toEqual(wed.slice(0, 2));
    expect(ids(n, SUN1)).toEqual(wed.slice(2));
    // No watched lecture ever comes back into the schedule.
    for (const day of next) {
      for (const id of day.lectureIds) expect(watched.has(id), id).toBe(false);
    }
    // And nothing else changed.
    assertOtherDaysUnchanged(repacked, next, [WED1, SUN1]);
  });
});
