import type { Lecture, PlanConfig, Subject, Topic } from '../src/types';
import { defaultPlanConfig } from '../src/lib/exportImport';
import { createIdFactory, slugify } from '../src/lib/id';

/** Build a curriculum from a compact spec. */
export function makeSubjects(
  spec: { name: string; instructor?: string; topics: { name: string; lectures: (string | number)[] }[] }[],
): Subject[] {
  const subjectIds = createIdFactory();
  const subjects: Subject[] = [];
  for (const s of spec) {
    const subjectId = subjectIds(slugify(s.name));
    const topicIds = createIdFactory();
    const topics: Topic[] = s.topics.map((t) => {
      const topicId = topicIds(`${subjectId}__${slugify(t.name)}`);
      const lectureIds = createIdFactory();
      const lectures: Lecture[] = t.lectures.map((entry, i) => {
        const name = typeof entry === 'string' ? entry : `Lecture ${i + 1}`;
        const durationSec = typeof entry === 'number' ? entry : 3600;
        return { id: lectureIds(`${topicId}__${slugify(name)}`), name, durationSec };
      });
      return { id: topicId, name: t.name, lectures };
    });
    subjects.push({ id: subjectId, name: s.name, instructor: s.instructor ?? '', topics });
  }
  return subjects;
}

/**
 * `hours('A', 1, 2, 3)` -> subject A with three lectures of 1h, 2h, 3h
 * (one topic, and the lectures in the given order).
 */
export function hours(name: string, ...durations: number[]) {
  return {
    name,
    topics: [{ name: `${name} topic`, lectures: durations.map((h) => h * 3600) }],
  };
}

export function makePlan(overrides: Partial<PlanConfig> = {}): PlanConfig {
  return {
    ...defaultPlanConfig('2026-09-15'),
    playbackSpeed: 1,
    ...overrides,
  };
}

/** lectureId -> watched progress map. */
export function watched(subjects: Subject[], predicate: (subjectName: string, index: number) => boolean) {
  const out: Record<string, { lectureId: string; lectureWatched: boolean; notesDone: boolean; questionsDone: boolean; completedDate: string | null }> = {};
  for (const subject of subjects) {
    let i = 0;
    for (const topic of subject.topics) {
      for (const lecture of topic.lectures) {
        if (predicate(subject.name, i)) {
          out[lecture.id] = {
            lectureId: lecture.id,
            lectureWatched: true,
            notesDone: false,
            questionsDone: false,
            completedDate: '2026-09-15',
          };
        }
        i++;
      }
    }
  }
  return out;
}
