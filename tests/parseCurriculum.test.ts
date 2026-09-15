import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CurriculumParseError,
  buildLectureIndex,
  parseCurriculumDetailed,
  parseCurriculumJSON,
  subjectStats,
} from '../src/lib/parseCurriculum';
import { parseDuration } from '../src/lib/duration';

const fixture = readFileSync(resolve(__dirname, 'fixtures/sample-curriculum.json'), 'utf8');

describe('parseDuration', () => {
  it('parses HH:MM:SS with and without zero padding', () => {
    expect(parseDuration('01:31:51')).toBe(5511);
    expect(parseDuration('1:31:51')).toBe(5511);
    expect(parseDuration('00:33:03')).toBe(1983);
  });

  it('parses MM:SS and plain seconds', () => {
    expect(parseDuration('12:30')).toBe(750);
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration(120)).toBe(120);
  });

  it('parses labelled durations', () => {
    expect(parseDuration('1h 20m')).toBe(4800);
    expect(parseDuration('45m')).toBe(2700);
  });

  it('treats junk, null and undefined as zero without throwing', () => {
    expect(parseDuration('n/a')).toBe(0);
    expect(parseDuration(null)).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
    expect(parseDuration('')).toBe(0);
    expect(parseDuration(-5)).toBe(0);
  });
});

describe('parseCurriculumJSON', () => {
  it('parses the documented shape', () => {
    const subjects = parseCurriculumJSON(fixture);
    expect(subjects.map((s) => s.name)).toEqual([
      'Anatomy and Physiology',
      'Empty Subject',
      'Microbiology',
    ]);
    const anatomy = subjects[0];
    expect(anatomy.instructor).toBe('Dr Shrikant Verma');
    expect(anatomy.topics).toHaveLength(2);
    expect(anatomy.topics[0].lectures).toHaveLength(2);
    expect(anatomy.topics[0].lectures[0]).toEqual({
      id: expect.stringContaining('introduction-of-anatomy'),
      name: 'Introduction of Anatomy',
      durationSec: 5511,
    });
  });

  it('generates stable ids of the form subject__topic__lecture', () => {
    const [subjects] = [parseCurriculumJSON(fixture)];
    const lecture = subjects[0].topics[0].lectures[0];
    expect(lecture.id).toBe(
      'anatomy-and-physiology__introduction-to-anatomical-term-and-organisation__introduction-of-anatomy',
    );
  });

  it('id stability: re-importing the same file yields identical ids', () => {
    const a = parseCurriculumJSON(fixture);
    const b = parseCurriculumJSON(fixture);
    expect(flattenIds(a)).toEqual(flattenIds(b));
  });

  it('id stability: inserting a lecture upstream does not shift existing ids', () => {
    const raw = JSON.parse(fixture) as Record<string, any>;
    const topics = raw['Anatomy and Physiology'].topics;
    topics[0].subtopics.splice(1, 0, { name: 'Brand New Lecture', duration: '00:10:00' });
    // Append a whole new topic too.
    topics.push({
      topic: 'Later Addition',
      subtopics: [{ name: 'New Topic Lecture', duration: '00:20:00' }],
    });

    const before = new Set(flattenIds(parseCurriculumJSON(fixture)));
    const after = new Set(flattenIds(parseCurriculumJSON(JSON.stringify(raw))));

    for (const id of before) expect(after.has(id)).toBe(true);
    expect(after.size).toBe(before.size + 2);
  });

  it('keeps lectures with malformed durations (duration 0) instead of dropping them', () => {
    const subjects = parseCurriculumJSON(fixture);
    const cell = subjects[0].topics[1].lectures;
    expect(cell.map((l) => l.name)).toEqual([
      'Cell Structure',
      'Tissue Types',
      'Broken Duration',
      'Missing Duration',
      'Odd Format',
    ]);
    expect(cell[2].durationSec).toBe(0);
    expect(cell[3].durationSec).toBe(0);
    expect(cell[4].durationSec).toBe(4800);
  });

  it('reports warnings for bad durations, empty topics and duplicate names', () => {
    const { warnings } = parseCurriculumDetailed(fixture);
    const kinds = warnings.map((w) => w.kind);
    expect(kinds).toContain('bad-duration');
    expect(kinds).toContain('empty-subject');
    expect(kinds).toContain('empty-topic');
    expect(kinds).toContain('duplicate-lecture-name');
  });

  it('handles a subject with zero topics and a topic with zero lectures', () => {
    const subjects = parseCurriculumJSON(fixture);
    expect(subjects[1].topics).toHaveLength(0);
    expect(subjectStats(subjects[1])).toEqual({ lectureCount: 0, totalSec: 0 });
    expect(subjects[2].topics[0].lectures).toHaveLength(0);
  });

  it('gives duplicate lecture names distinct ids', () => {
    const subjects = parseCurriculumJSON(fixture);
    const [a, b] = subjects[2].topics[1].lectures;
    expect(a.id).not.toBe(b.id);
  });

  it('rejects garbage rather than returning a broken curriculum', () => {
    expect(() => parseCurriculumJSON('not json')).toThrow(CurriculumParseError);
    expect(() => parseCurriculumJSON('[]')).toThrow(CurriculumParseError);
    expect(() => parseCurriculumJSON('{}')).toThrow(CurriculumParseError);
    expect(() => parseCurriculumJSON('')).toThrow(CurriculumParseError);
  });

  it('builds a lecture index with subject/topic back-references', () => {
    const subjects = parseCurriculumJSON(fixture);
    const index = buildLectureIndex(subjects);
    const ref = index.get(subjects[0].topics[0].lectures[1].id)!;
    expect(ref.subject.name).toBe('Anatomy and Physiology');
    expect(ref.topic.name).toBe('Introduction to Anatomical Term and Organisation');
    expect(ref.indexInSubject).toBe(1);
    expect(ref.subjectLectureCount).toBe(7);
  });
});

function flattenIds(subjects: ReturnType<typeof parseCurriculumJSON>): string[] {
  return subjects.flatMap((s) => s.topics.flatMap((t) => t.lectures.map((l) => l.id)));
}
