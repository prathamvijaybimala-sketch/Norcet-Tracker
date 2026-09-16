/**
 * End-to-end sanity check from the project spec (section 8.2), using the
 * generated demo curriculum (public/demo-curriculum.json), which reproduces the
 * real curriculum's shape: 8 subjects, 767 lectures, 516.1 raw hours, ~40 min
 * average lecture.
 *
 * Settings: Community Health Nursing -> Obs/Gyn -> Pediatrics -> Surgery ->
 * Medicine -> Nursing Foundation -> Pharmacology -> Microbiology, 3 hrs/day,
 * 6 days/week, 1.5x speed, starting 2026-09-15.
 *
 * A note on the expected span: dividing raw hours naively
 * (516.1 h / 1.5 / 3 h per day = 114.7 study days, ~134 calendar days, + 33
 * buffer days) predicts ~167-172 days / ~24 weeks. The real bin-packer lands
 * slightly longer (~186 days) because lectures are never split across days, so
 * every day is under-filled by the remainder of the next lecture (about 10%
 * here) and every subject boundary wastes part of a day. That waste is required
 * by section 5.1, so the assertions below use a band around the estimate rather
 * than the estimate itself.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildLectureIndex,
  parseCurriculumDetailed,
  subjectStats,
} from '../src/lib/parseCurriculum';
import { catchUpPlan, generateSchedule, lastStudyDate } from '../src/lib/schedule';
import { computePlanStats, computeTodayStats } from '../src/lib/stats';
import { suggestBufferForSubject } from '../src/lib/buffer';
import { defaultPlanConfig } from '../src/lib/exportImport';
import {
  buildExportPayload,
  payloadSummary,
  validateExportPayload,
} from '../src/lib/exportImport';
import { syncRevisionQueue, dueRevisions } from '../src/lib/revision';
import type { PlanConfig, ProgressStore, Subject } from '../src/types';

const ORDER = [
  'Community Health Nursing',
  'Midwifery and Obstetrical Nursing',
  'Child Health Nursing',
  'Medical Surgical Nursing (Surgery)',
  'Medical Surgical Nursing (Medicine)',
  'Nursing Foundation',
  'Pharmacology',
  'Microbiology',
];

const demo = readFileSync(resolve(__dirname, '../public/demo-curriculum.json'), 'utf8');

function setup() {
  const { subjects, lectureCount, totalSec } = parseCurriculumDetailed(demo);
  const byName = new Map(subjects.map((s) => [s.name, s]));
  const order = ORDER.map((name) => {
    const subject = byName.get(name);
    if (!subject) throw new Error(`demo curriculum is missing ${name}`);
    return subject.id;
  });
  const bufferDaysBySubject: Record<string, number> = {};
  for (const subject of subjects) {
    bufferDaysBySubject[subject.id] = suggestBufferForSubject(
      subjectStats(subject).totalSec,
      1.5,
    );
  }
  const planConfig: PlanConfig = {
    ...defaultPlanConfig('2026-09-15', order),
    dailyHours: 3,
    studyDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
    playbackSpeed: 1.5,
    bufferDaysBySubject,
  };
  return { subjects, planConfig, lectureCount, totalSec, byName };
}

describe('section 8.2 sanity check', () => {
  it('imports the demo curriculum at the expected scale', () => {
    const { subjects, lectureCount, totalSec } = setup();
    expect(subjects).toHaveLength(8);
    expect(lectureCount).toBeGreaterThan(600);
    expect(totalSec / 3600).toBeCloseTo(516.1, 1);
  });

  it('generates a ~24-27 week plan finishing in March 2027', () => {
    const { subjects, planConfig } = setup();
    const schedule = generateSchedule(subjects, planConfig, {});
    const stats = computePlanStats(schedule);

    expect(stats.finishDate).toBe('2027-03-16');
    // ~172 days was the hour-division estimate; bin-packing adds ~8%.
    expect(stats.totalDays).toBeGreaterThanOrEqual(168);
    expect(stats.totalDays).toBeLessThanOrEqual(196);
    expect(stats.weeks).toBeGreaterThanOrEqual(24);
    expect(stats.weeks).toBeLessThanOrEqual(28);
    expect(stats.finishDate!.startsWith('2027-03')).toBe(true);
    // Buffer days: 4 + 5 + 4 + 3 + 5 + 5 + 4 + 3.
    expect(stats.bufferDays).toBe(33);
    expect(stats.studyDays).toBeGreaterThanOrEqual(115);
    expect(stats.remainingLectures).toBe(767);
  });

  it('studies subjects in the configured order', () => {
    const { subjects, planConfig } = setup();
    const schedule = generateSchedule(subjects, planConfig, {});
    let previousDate = '';
    for (const subjectId of planConfig.subjectOrder) {
      const first = schedule.find((d) => d.subjectId === subjectId)!;
      expect(first.date >= previousDate).toBe(true);
      previousDate = first.date;
    }
    const firstDay = schedule[0];
    expect(firstDay.date).toBe('2026-09-15');
    expect(firstDay.subjectId).toBe(planConfig.subjectOrder[0]);
  });

  it('marks a chunk of Obs/Gyn pre-done and the plan does NOT compress', () => {
    const { subjects, planConfig, byName } = setup();
    const beforeSchedule = generateSchedule(subjects, planConfig, {});
    const before = computePlanStats(beforeSchedule);
    const obsGyn = byName.get('Midwifery and Obstetrical Nursing')!;

    const progress: ProgressStore = {};
    let n = 0;
    for (const topic of obsGyn.topics) {
      for (const lecture of topic.lectures) {
        if (n++ >= 100) break;
        progress[lecture.id] = {
          lectureId: lecture.id,
          lectureWatched: true,
          notesDone: false,
          questionsDone: false,
          completedDate: '2026-09-15',
        };
      }
    }
    expect(Object.keys(progress)).toHaveLength(100);

    // The fixed calendar never shrinks for progress: identical days and
    // lecture slots, same finish date.
    const afterSchedule = generateSchedule(subjects, planConfig, progress);
    expect(afterSchedule.map((d) => [d.date, d.lectureIds])).toEqual(
      beforeSchedule.map((d) => [d.date, d.lectureIds]),
    );
    const after = computePlanStats(afterSchedule, progress);
    expect(after.totalDays).toBe(before.totalDays);
    expect(after.finishDate).toBe(before.finishDate);
    // But the work remaining reflects what is watched.
    expect(after.remainingLectures).toBe(767 - 100);
  });

  it('shifts everything forward when a 5-day leave block is added in November', () => {
    const { subjects, planConfig } = setup();
    const before = generateSchedule(subjects, planConfig, {});
    const beforeStats = computePlanStats(before);

    const leaveDates: string[] = [];
    for (let d = 10; d <= 14; d++) leaveDates.push(`2026-11-${String(d).padStart(2, '0')}`);
    const withLeave = { ...planConfig, leaveDates };
    const after = generateSchedule(subjects, withLeave, {});
    const afterStats = computePlanStats(after);

    // The plan can never get shorter, and the finish date moves later. (It
    // usually moves by about the length of the leave block; the exact shift
    // differs by a day or two because buffer blocks are counted in calendar
    // days, so a Sunday that lands inside a buffer block stops costing a day.)
    expect(afterStats.totalDays).toBeGreaterThan(beforeStats.totalDays);
    expect(afterStats.finishDate! > beforeStats.finishDate!).toBe(true);
    expect(afterStats.studyDays).toBe(beforeStats.studyDays);
    for (const date of leaveDates) {
      const day = after.find((d) => d.date === date)!;
      expect(day.type).toBe('off');
      expect(day.isLeaveDay).toBe(true);
      expect(day.lectureIds).toHaveLength(0);
    }
  });

  it('reports "days behind" instead of silently reflowing, until catch-up is asked for', () => {
    const { subjects, planConfig } = setup();
    // Fast-forward: it is now 2026-12-01 and nothing has been watched.
    const today = '2026-12-01';
    let schedule = generateSchedule(subjects, planConfig, {});
    let stats = computeTodayStats(subjects, planConfig, {}, schedule, today);
    expect(stats.backlogLectures).toBeGreaterThan(100);
    expect(stats.deltaDays).toBeLessThan(-10);

    // Still not reflowed: past days keep their lectures.
    expect(schedule.filter((d) => d.date < today && d.type === 'study').length).toBeGreaterThan(50);

    // Explicit catch-up moves the whole remaining pool to today.
    const caughtUp = catchUpPlan(planConfig, today);
    schedule = generateSchedule(subjects, caughtUp, {});
    stats = computeTodayStats(subjects, caughtUp, {}, schedule, today);
    expect(schedule[0].date).toBe(today);
    expect(stats.backlogLectures).toBe(0);
    // Re-planning from today necessarily finishes later than the original
    // plan's finish date - two and a half months of calendar time were given up.
    expect(lastStudyDate(schedule)! > beforeFinish(planConfig, subjects, today)).toBe(true);
  });

  it('round-trips through export and import without losing anything', () => {
    const { subjects, planConfig } = setup();
    const progress: ProgressStore = {};
    const first = subjects[0].topics[0].lectures[0];
    progress[first.id] = {
      lectureId: first.id,
      lectureWatched: true,
      notesDone: true,
      questionsDone: true,
      completedDate: '2026-09-15',
    };
    const { revision } = syncRevisionQueue(progress, {}, [3, 14, 30], '2026-09-15');
    expect(dueRevisions(revision, '2026-09-18')).toHaveLength(1);

    const payload = buildExportPayload(subjects, planConfig, progress, revision);
    const parsed = validateExportPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(payloadSummary(parsed.payload)).toEqual({
      subjects: 8,
      lectures: 767,
      progressEntries: 1,
      watched: 1,
      revisionItems: 1,
      exportedAt: payload.exportedAt,
    });

    const restoredSchedule = generateSchedule(
      parsed.payload.curriculum,
      parsed.payload.planConfig,
      parsed.payload.progress,
    );
    expect(restoredSchedule).toEqual(generateSchedule(subjects, planConfig, progress));
    expect(buildLectureIndex(parsed.payload.curriculum).size).toBe(767);
  });

  it('rejects a malformed backup before touching state', () => {
    expect(validateExportPayload(null).ok).toBe(false);
    expect(validateExportPayload({}).ok).toBe(false);
    expect(validateExportPayload({ curriculum: [], planConfig: {} }).ok).toBe(false);
    const { subjects, planConfig } = setup();
    const good = buildExportPayload(subjects, planConfig, {}, {});
    const broken = { ...good, planConfig: { ...planConfig, dailyHours: 0 } };
    const result = validateExportPayload(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dailyHours/);
  });
});

function beforeFinish(planConfig: PlanConfig, subjects: Subject[], today: string): string {
  const schedule = generateSchedule(subjects, planConfig, {});
  return lastStudyDate(schedule) ?? today;
}
