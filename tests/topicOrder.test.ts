import { describe, expect, it } from 'vitest';
import { generateSchedule, orderedTopics } from '../src/lib/schedule';
import { defaultPlanConfig, normalizePlanConfig } from '../src/lib/exportImport';
import { makePlan, makeSubjects } from './helpers';
import type { PlanConfig } from '../src/types';

const START = '2026-09-15'; // a Tuesday

/** One subject, three topics, one 1h lecture each. At 1h/day each topic
 *  fills exactly one day, so the day sequence mirrors the topic order. */
function threeTopics() {
  const [subject] = makeSubjects([
    {
      name: 'Subject',
      topics: [
        { name: 'Alpha', lectures: [3600] },
        { name: 'Beta', lectures: [3600] },
        { name: 'Gamma', lectures: [3600] },
      ],
    },
  ]);
  return subject;
}

function plan(subjectId: string, overrides: Partial<PlanConfig> = {}): PlanConfig {
  return makePlan({
    startDate: START,
    subjectOrder: [subjectId],
    dailyHours: 1,
    playbackSpeed: 1,
    ...overrides,
  });
}

const lectureOf = (topic: number) => threeTopics().topics[topic].lectures[0].id;

describe('orderedTopics', () => {
  it('keeps the curriculum order when the subject has no stored order', () => {
    const subject = threeTopics();
    expect(orderedTopics(subject, {}).map((t) => t.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(orderedTopics(subject, undefined).map((t) => t.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('applies the stored order and survives stale, duplicated or missing ids', () => {
    const subject = threeTopics();
    const [a, b, c] = subject.topics.map((t) => t.id);
    // full reorder
    expect(orderedTopics(subject, { [subject.id]: [c, a, b] }).map((t) => t.name)).toEqual([
      'Gamma',
      'Alpha',
      'Beta',
    ]);
    // stale id ignored, duplicate ignored, missing topic appended at the end
    expect(
      orderedTopics(subject, { [subject.id]: [b, 'does-not-exist', b, a] }).map((t) => t.name),
    ).toEqual(['Beta', 'Alpha', 'Gamma']);
    // empty list -> curriculum order, nothing lost
    expect(orderedTopics(subject, { [subject.id]: [] }).map((t) => t.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });
});

describe('generateSchedule with topicOrder', () => {
  it('packs lectures in the curriculum topic order by default', () => {
    const subject = threeTopics();
    const schedule = generateSchedule([subject], plan(subject.id), {});
    expect(schedule.map((d) => d.lectureIds[0])).toEqual([
      lectureOf(0),
      lectureOf(1),
      lectureOf(2),
    ]);
  });

  it('packs lectures in the dragged topic order when one is stored', () => {
    const subject = threeTopics();
    const [a, b, c] = subject.topics.map((t) => t.id);
    const schedule = generateSchedule(
      [subject],
      plan(subject.id, { topicOrder: { [subject.id]: [c, a, b] } }),
      {},
    );
    expect(schedule.map((d) => d.lectureIds[0])).toEqual([
      lectureOf(2),
      lectureOf(0),
      lectureOf(1),
    ]);
    // nothing lost: every lecture still scheduled exactly once
    expect(schedule.flatMap((d) => d.lectureIds).sort()).toEqual([
      lectureOf(0),
      lectureOf(1),
      lectureOf(2),
    ].sort());
  });

  it('preDone lectures stay excluded in the reordered pack', () => {
    const subject = threeTopics();
    const [a, b, c] = subject.topics.map((t) => t.id);
    const progress = {
      [lectureOf(0)]: {
        lectureId: lectureOf(0),
        lectureWatched: true,
        notesDone: false,
        questionsDone: false,
        completedDate: null,
        preDone: true,
      },
    };
    const schedule = generateSchedule(
      [subject],
      plan(subject.id, { topicOrder: { [subject.id]: [c, a, b] } }),
      progress,
    );
    expect(schedule.flatMap((d) => d.lectureIds)).toEqual([lectureOf(2), lectureOf(1)]);
  });
});

describe('planConfig persistence of topicOrder', () => {
  it('defaultPlanConfig starts with an empty topicOrder', () => {
    expect(defaultPlanConfig(START).topicOrder).toEqual({});
  });

  it('normalizePlanConfig keeps valid orders and drops garbage', () => {
    const normalized = normalizePlanConfig({
      ...defaultPlanConfig(START),
      topicOrder: {
        s1: ['a', 'b'],
        s2: ['x', 42, 'y', null],
        s3: 'not-an-array',
      },
    } as unknown as Record<string, unknown>);
    expect(normalized.topicOrder).toEqual({ s1: ['a', 'b'], s2: ['x', 'y'] });

    expect(
      (normalizePlanConfig({ ...defaultPlanConfig(START), topicOrder: 'nope' } as unknown as Record<string, unknown>)
        .topicOrder),
    ).toEqual({});
  });
});
