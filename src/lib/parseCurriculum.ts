/**
 * Curriculum import parser (section 1 of the spec).
 *
 * Pure, dependency-free and unit-testable: `parseCurriculumJSON(raw)` maps the
 * raw lecture-curriculum JSON onto `Subject[]`, generating *stable* ids from
 * names (never array indexes) so that progress survives re-imports.
 */

import type { Lecture, Subject, Topic } from '../types';
import { parseDuration } from './duration';
import { createIdFactory, slugify } from './id';

export type ParseWarningKind =
  | 'bad-duration'
  | 'empty-subject'
  | 'empty-topic'
  | 'missing-name'
  | 'duplicate-lecture-name';

export type ParseWarning = {
  kind: ParseWarningKind;
  message: string;
  subject?: string;
  topic?: string;
  lecture?: string;
};

export type ParseResult = {
  subjects: Subject[];
  warnings: ParseWarning[];
  lectureCount: number;
  totalSec: number;
};

export class CurriculumParseError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Parse raw curriculum JSON (string or already-parsed value) into `Subject[]`.
 * Throws `CurriculumParseError` when the top-level shape is unusable.
 */
export function parseCurriculumJSON(raw: string | unknown): Subject[] {
  return parseCurriculumDetailed(raw).subjects;
}

/**
 * Same as `parseCurriculumJSON` but also returns warnings and totals, which the
 * import screen shows to the user. Malformed individual records are repaired
 * (never dropped) and reported as warnings rather than thrown.
 */
export function parseCurriculumDetailed(raw: string | unknown): ParseResult {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) throw new CurriculumParseError('The file is empty.');
    try {
      data = JSON.parse(trimmed);
    } catch (err) {
      throw new CurriculumParseError(
        `That is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!isPlainObject(data)) {
    throw new CurriculumParseError(
      'Expected a JSON object whose keys are subject names, e.g. { "Anatomy and Physiology": { "topics": [...] } }.',
    );
  }

  const warnings: ParseWarning[] = [];
  const subjectIds = createIdFactory();
  const subjects: Subject[] = [];
  let lectureCount = 0;
  let totalSec = 0;

  for (const [rawSubjectName, rawSubject] of Object.entries(data)) {
    const subjectName = text(rawSubjectName, '');
    if (!subjectName) {
      warnings.push({ kind: 'missing-name', message: 'Skipped an entry with a blank subject name.' });
      continue;
    }
    const subjectId = subjectIds(slugify(subjectName));
    const subjectBody = isPlainObject(rawSubject) ? rawSubject : {};
    if (!isPlainObject(rawSubject)) {
      warnings.push({
        kind: 'missing-name',
        subject: subjectName,
        message: `"${subjectName}" is not an object; imported as an empty subject.`,
      });
    }

    const rawTopics = Array.isArray(subjectBody.topics) ? subjectBody.topics : [];
    if (!Array.isArray(subjectBody.topics) && Object.keys(subjectBody).length > 0) {
      warnings.push({
        kind: 'empty-subject',
        subject: subjectName,
        message: `"${subjectName}" has no "topics" array; imported with 0 lectures.`,
      });
    }

    const topicIds = createIdFactory();
    const topics: Topic[] = [];

    for (const [topicIndex, rawTopic] of rawTopics.entries()) {
      if (!isPlainObject(rawTopic)) {
        warnings.push({
          kind: 'missing-name',
          subject: subjectName,
          message: `Skipped topic #${topicIndex + 1} of "${subjectName}" - not an object.`,
        });
        continue;
      }
      const topicName = text(rawTopic.topic ?? rawTopic.name, `Topic ${topicIndex + 1}`);
      const topicId = topicIds(`${subjectId}__${slugify(topicName)}`);
      const rawSubtopics = Array.isArray(rawTopic.subtopics) ? rawTopic.subtopics : [];
      if (rawSubtopics.length === 0) {
        warnings.push({
          kind: 'empty-topic',
          subject: subjectName,
          topic: topicName,
          message: `"${topicName}" has no lectures.`,
        });
      }

      const lectureIds = createIdFactory();
      const lectures: Lecture[] = [];

      for (const [lectureIndex, rawLecture] of rawSubtopics.entries()) {
        if (!isPlainObject(rawLecture)) {
          warnings.push({
            kind: 'missing-name',
            subject: subjectName,
            topic: topicName,
            message: `Skipped lecture #${lectureIndex + 1} of "${topicName}" - not an object.`,
          });
          continue;
        }
        const lectureName = text(rawLecture.name ?? rawLecture.title, `Lecture ${lectureIndex + 1}`);
        const key = `${topicId}__${slugify(lectureName)}`;
        const id = lectureIds(key);
        if (id !== key) {
          warnings.push({
            kind: 'duplicate-lecture-name',
            subject: subjectName,
            topic: topicName,
            lecture: lectureName,
            message: `Duplicate lecture name "${lectureName}" in "${topicName}" - kept both with distinct ids.`,
          });
        }

        const durationSec = parseDuration(rawLecture.duration);
        if (durationSec === 0) {
          warnings.push({
            kind: 'bad-duration',
            subject: subjectName,
            topic: topicName,
            lecture: lectureName,
            message: `"${lectureName}" has a missing or unreadable duration (${String(
              rawLecture.duration,
            )}); treated as 0 minutes.`,
          });
        }

        lectures.push({ id, name: lectureName, durationSec });
        lectureCount += 1;
        totalSec += durationSec;
      }

      topics.push({ id: topicId, name: topicName, lectures });
    }

    if (topics.length === 0) {
      warnings.push({
        kind: 'empty-subject',
        subject: subjectName,
        message: `"${subjectName}" has no topics.`,
      });
    }

    subjects.push({
      id: subjectId,
      name: subjectName,
      instructor: text(subjectBody.instructor, ''),
      topics,
    });
  }

  if (subjects.length === 0) {
    throw new CurriculumParseError('No subjects found in that JSON.');
  }

  return { subjects, warnings, lectureCount, totalSec };
}

export type SubjectStats = {
  lectureCount: number;
  totalSec: number;
};

export function subjectStats(subject: Subject): SubjectStats {
  let lectureCount = 0;
  let totalSec = 0;
  for (const topic of subject.topics) {
    lectureCount += topic.lectures.length;
    for (const lecture of topic.lectures) totalSec += lecture.durationSec;
  }
  return { lectureCount, totalSec };
}

/** lectureId -> { lecture, topic, subject }, built once per curriculum version. */
export type LectureRef = {
  lecture: Lecture;
  topic: Topic;
  subject: Subject;
  /** Index of the lecture within the flattened, ordered subject. */
  indexInSubject: number;
  /** Number of lectures in the subject (flattened). */
  subjectLectureCount: number;
};

export function buildLectureIndex(subjects: Subject[]): Map<string, LectureRef> {
  const index = new Map<string, LectureRef>();
  for (const subject of subjects) {
    let flat = 0;
    const total = subject.topics.reduce((n, t) => n + t.lectures.length, 0);
    for (const topic of subject.topics) {
      for (const lecture of topic.lectures) {
        index.set(lecture.id, { lecture, topic, subject, indexInSubject: flat++, subjectLectureCount: total });
      }
    }
  }
  return index;
}
