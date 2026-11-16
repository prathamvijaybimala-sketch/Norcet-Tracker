import { describe, expect, it } from 'vitest';
import {
  topicActiveLectureIds,
  topicLastScheduledDate,
  topicQuestionsUnlocked,
} from '../src/lib/topicQuestions';
import { hours, makeSubjects } from './helpers';
import type { LectureProgress } from '../src/types';

const [subject] = makeSubjects([hours('Split Subject', 1, 1, 1)]);
const topic = subject.topics[0];
const ids = topic.lectures.map((l) => l.id);

const watchedEntry = (id: string): LectureProgress => ({
  lectureId: id,
  lectureWatched: true,
  notesDone: true,
  questionsDone: false,
  completedDate: '2026-09-15',
});

function scheduleAt(...pairs: [string, string][]): Map<string, string> {
  return new Map(pairs);
}

describe('topicActiveLectureIds', () => {
  it('includes scheduled and already-watched lectures, excludes unscheduled-unwatched ones', () => {
    const sched = scheduleAt([ids[0], '2026-09-15'], [ids[1], '2026-09-16']);
    // ids[2] is watched but no longer scheduled -> still part of the topic.
    expect(topicActiveLectureIds(topic, sched, { [ids[2]]: watchedEntry(ids[2]) }).sort()).toEqual(
      [...ids].sort(),
    );
    // ...but unwatched AND unscheduled (excluded / dropped) is not.
    expect(topicActiveLectureIds(topic, sched, {})).toEqual([ids[0], ids[1]]);
  });

  it('is empty when nothing is scheduled and nothing is watched', () => {
    expect(topicActiveLectureIds(topic, new Map(), {})).toEqual([]);
  });
});

describe('topicLastScheduledDate', () => {
  it('finds the day of the topic final scheduled lecture', () => {
    const sched = scheduleAt([ids[0], '2026-09-15'], [ids[1], '2026-09-17'], [ids[2], '2026-09-16']);
    expect(topicLastScheduledDate(ids, sched)).toBe('2026-09-17');
    expect(topicLastScheduledDate(ids, new Map())).toBeNull();
  });
});

describe('topicQuestionsUnlocked', () => {
  it('locks the checkbox until the topic last scheduled day', () => {
    const sched = scheduleAt([ids[0], '2026-09-15'], [ids[1], '2026-09-16'], [ids[2], '2026-09-17']);
    expect(topicQuestionsUnlocked(ids, sched, '2026-09-15')).toBe(false);
    expect(topicQuestionsUnlocked(ids, sched, '2026-09-16')).toBe(false);
    expect(topicQuestionsUnlocked(ids, sched, '2026-09-17')).toBe(true);
    expect(topicQuestionsUnlocked(ids, sched, '2026-09-18')).toBe(true);
  });

  it('unlocks immediately once the topic has nothing scheduled left', () => {
    expect(topicQuestionsUnlocked(ids, new Map(), '2026-09-15')).toBe(true);
  });
});
