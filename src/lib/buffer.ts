/**
 * Buffer auto-suggestion (section 3.2.1).
 *
 * A pure, overridable heuristic: buffer days are scaled to the *effective*
 * (speed-adjusted) hours of a subject, because that - not the raw runtime - is
 * what the student actually spends on it.
 *
 *   < 20 eff. hours -> 3 days
 *   20-50 eff hours -> 4 days
 *   > 50 eff hours  -> 5 days
 */

export const BUFFER_THRESHOLDS = [
  { maxEffectiveHours: 20, days: 3 },
  { maxEffectiveHours: 50, days: 4 },
  { maxEffectiveHours: Infinity, days: 5 },
] as const;

export function suggestBufferDays(effectiveHours: number): number {
  if (!Number.isFinite(effectiveHours) || effectiveHours <= 0) return 0;
  for (const tier of BUFFER_THRESHOLDS) {
    if (effectiveHours < tier.maxEffectiveHours) return tier.days;
  }
  return 5;
}

/**
 * Suggested buffer for a subject given the current playback speed.
 * `rawSeconds` is the un-adjusted total runtime of the subject.
 */
export function suggestBufferForSubject(rawSeconds: number, playbackSpeed: number): number {
  const speed = playbackSpeed > 0 ? playbackSpeed : 1;
  return suggestBufferDays(rawSeconds / 3600 / speed);
}
