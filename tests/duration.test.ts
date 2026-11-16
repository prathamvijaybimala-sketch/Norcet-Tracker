import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, parseDuration } from '../src/lib/duration';

describe('formatDuration', () => {
  it('renders plain minutes and hours', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(3540)).toBe('59m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(5491)).toBe('1h 32m');
  });

  it('carries a rounded 60 minutes up to the hour instead of printing 60m', () => {
    // 59m30s rounds to 60m -> must become 1h, not "60m".
    expect(formatDuration(3570)).toBe('1h');
    // 59m59s also rounds up.
    expect(formatDuration(3599)).toBe('1h');
    // ...but 58m30s rounds to 59m and stays put.
    expect(formatDuration(3510)).toBe('59m');
  });
});

describe('formatClock', () => {
  it('zero-pads minutes and seconds', () => {
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(3661)).toBe('1:01:01');
  });
});

describe('parseDuration edge cases', () => {
  it('never throws on odd strings', () => {
    // Unlabelled trailing number is not a unit: "1h20" = 1h (the 20 is noise).
    expect(parseDuration('1h20')).toBe(3600);
    expect(parseDuration('1h 30m')).toBe(5400);
    expect(parseDuration('45m')).toBe(2700);
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('n/a')).toBe(0);
  });
});
