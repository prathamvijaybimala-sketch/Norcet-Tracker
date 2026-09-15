/**
 * Duration parsing.
 *
 * Source data is `HH:MM:SS` strings, but it is not always zero-padded and may
 * be missing / malformed. Parse defensively and never throw: unparseable
 * durations become 0 but the lecture is still kept (we never silently drop
 * curriculum content).
 */

const HH_MM_SS = /^\s*(\d+)\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/;
const MM_SS = /^\s*(\d+)\s*:\s*(\d{1,2})\s*$/;
const HMS_LABELLED = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;

export function parseDuration(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  }
  if (typeof raw !== 'string') return 0;

  const value = raw.trim();
  if (!value) return 0;

  const hms = HH_MM_SS.exec(value);
  if (hms) {
    return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  }

  const ms = MM_SS.exec(value);
  if (ms) {
    // Bare "MM:SS" (some exports drop the hour component).
    return Number(ms[1]) * 60 + Number(ms[2]);
  }

  // Plain seconds.
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  // Labelled forms such as "1h 30m", "45m", "1h20".
  if (/[hms]/i.test(value)) {
    const m = HMS_LABELLED.exec(value);
    if (m && (m[1] || m[2] || m[3])) {
      return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    }
  }

  return 0;
}

/** `formatDurationSec(5491) -> "1:31:51"`, `formatClock(5491) -> "01:31:51"`. */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Human friendly length, e.g. `formatDuration(5491) -> "1h 32m"`. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Hours with one decimal, e.g. `formatHours(5491) -> "1.5"`. */
export function formatHours(totalSec: number): string {
  return (totalSec / 3600).toFixed(1);
}
