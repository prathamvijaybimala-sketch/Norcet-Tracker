import { describe, expect, it } from 'vitest';
import {
  DAY_LINES,
  DONE_MESSAGES,
  MILESTONE_MESSAGES,
  STUDY_LINES,
  doneMessageFor,
  greetingFor,
  milestoneMessageFor,
  nameForDay,
  studyLineFor,
} from '../src/lib/dayFlavor';

const DAY = '2026-09-17';

describe('nameForDay', () => {
  it('shows any other saved name as-is', () => {
    expect(nameForDay('Priya', DAY)).toBe('Priya');
    expect(nameForDay('Aarav', DAY)).toBe('Aarav');
    expect(nameForDay('', DAY)).toBe('');
  });

  it('saloni (any casing) flips through the nickname family, stable per day', () => {
    for (const variant of ['saloni', 'Saloni', 'SALONI']) {
      const a = nameForDay(variant, DAY);
      expect(a).toBe(nameForDay(variant, DAY)); // stable within the day
      expect(['Saloni', 'Shalu', 'Meloni']).toContain(a);
    }
    expect(nameForDay('SALONI', DAY)).toBe(nameForDay('saloni', DAY));
    // different days may differ (the roulette)
    const all = new Set(
      Array.from({ length: 100 }, (_, i) => nameForDay('saloni', `2026-03-${String((i % 28) + 1).padStart(2, '0')}`)),
    );
    expect(all.size).toBeGreaterThan(1);
  });

  it('the roulette stays close to 70/20/10 over a year', () => {
    const counts: Record<string, number> = { Saloni: 0, Shalu: 0, Meloni: 0 };
    const start = new Date(2026, 0, 1);
    for (let i = 0; i < 365; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
      counts[nameForDay('saloni', iso)]++;
    }
    // deterministic hash, but the mix must feel like the requested odds
    expect(counts.Shalu).toBeGreaterThanOrEqual(50);
    expect(counts.Shalu).toBeLessThanOrEqual(100);
    expect(counts.Meloni).toBeGreaterThanOrEqual(20);
    expect(counts.Meloni).toBeLessThanOrEqual(60);
    expect(counts.Saloni).toBe(365 - counts.Shalu - counts.Meloni);
  });
});

describe('greetingFor', () => {
  it('maps hours to the right line and emoji', () => {
    expect(greetingFor(4)).toEqual({ text: 'Still up? It\'s late', emoji: '🌙' });
    expect(greetingFor(5)).toEqual({ text: 'Good Morning', emoji: '🌅' });
    expect(greetingFor(11)).toEqual({ text: 'Good Morning', emoji: '🌅' });
    expect(greetingFor(12)).toEqual({ text: 'Good Afternoon', emoji: '🌞' });
    expect(greetingFor(15)).toEqual({ text: 'Good Afternoon', emoji: '🌞' });
    expect(greetingFor(16)).toEqual({ text: 'Good Evening', emoji: '🌇' });
    expect(greetingFor(18)).toEqual({ text: 'Good Evening', emoji: '🌇' });
    expect(greetingFor(19)).toEqual({ text: 'Good Night', emoji: '🌃' });
    expect(greetingFor(23)).toEqual({ text: 'Good Night', emoji: '🌃' });
    expect(greetingFor(0)).toEqual({ text: 'Still up? It\'s late', emoji: '🌙' });
  });
});

describe('studyLineFor', () => {
  it('Monday and Sunday get their own lines regardless of time', () => {
    expect(studyLineFor('2026-09-14', 8)).toBe(DAY_LINES.monday); // a Monday
    expect(studyLineFor('2026-09-14', 22)).toBe(DAY_LINES.monday);
    expect(studyLineFor('2026-09-20', 9)).toBe(DAY_LINES.sunday); // a Sunday
    expect(studyLineFor('2026-09-20', 23)).toBe(DAY_LINES.sunday);
  });

  it('other weekdays pick from the current time band, stable per day', () => {
    // 2026-09-15 is a Tuesday
    expect(studyLineFor('2026-09-15', 8)).toBe(studyLineFor('2026-09-15', 8));
    expect(STUDY_LINES.morning).toContain(studyLineFor('2026-09-15', 8));
    expect(STUDY_LINES.afternoon).toContain(studyLineFor('2026-09-15', 13));
    expect(STUDY_LINES.evening).toContain(studyLineFor('2026-09-15', 17));
    expect(STUDY_LINES.night).toContain(studyLineFor('2026-09-15', 21));
    // a different day can give a different line
    const all = new Set(
      Array.from({ length: 30 }, (_, i) => studyLineFor(`2026-05-${String((i % 28) + 2).padStart(2, '0')}`, 9)),
    );
    expect(all.size).toBeGreaterThan(1);
  });
});

describe('doneMessageFor', () => {
  it('is stable per day and substitutes the name', () => {
    const a = doneMessageFor(DAY, 'Shalu');
    expect(a).toBe(doneMessageFor(DAY, 'Shalu'));
    expect(DONE_MESSAGES.some((m) => m.replace('{name}', 'Shalu') === a)).toBe(true);
    expect(a).not.toContain('{name}');
  });

  it('never contains an em dash (house style)', () => {
    for (const m of DONE_MESSAGES) expect(m).not.toContain('—');
    for (const lines of Object.values(STUDY_LINES)) for (const m of lines) expect(m).not.toContain('—');
    for (const m of MILESTONE_MESSAGES) expect(m).not.toContain('—');
    expect(DAY_LINES.monday).not.toContain('—');
    expect(DAY_LINES.sunday).not.toContain('—');
  });
});

describe('milestoneMessageFor', () => {
  it('includes the streak count and Pratham, stable per value', () => {
    for (const x of [5, 10, 15, 20]) {
      const m = milestoneMessageFor(x);
      expect(m).toBe(milestoneMessageFor(x));
      expect(m).toContain(String(x));
      expect(m).toContain('Pratham');
      expect(m).not.toContain('{x}');
    }
  });
});
