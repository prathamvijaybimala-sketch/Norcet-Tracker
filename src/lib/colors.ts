/** Deterministic, stable per-subject colours (used by the timeline + badges). */

const PALETTE = [
  { name: 'indigo', hue: 243, sat: 75 },
  { name: 'teal', hue: 172, sat: 66 },
  { name: 'amber', hue: 38, sat: 92 },
  { name: 'rose', hue: 350, sat: 74 },
  { name: 'violet', hue: 271, sat: 71 },
  { name: 'lime', hue: 88, sat: 60 },
  { name: 'sky', hue: 199, sat: 85 },
  { name: 'orange', hue: 22, sat: 88 },
  { name: 'emerald', hue: 152, sat: 58 },
  { name: 'fuchsia', hue: 300, sat: 68 },
  { name: 'cyan', hue: 187, sat: 72 },
  { name: 'yellow', hue: 50, sat: 92 },
  { name: 'blue', hue: 217, sat: 85 },
  { name: 'green', hue: 130, sat: 55 },
  { name: 'red', hue: 5, sat: 74 },
  { name: 'purple', hue: 258, sat: 62 },
];

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export type SubjectColor = {
  /** Solid colour for dots / bars. */
  base: string;
  /** Translucent fill for calendar cells. */
  soft: string;
  /** Readable text colour on `soft`. */
  text: string;
  hue: number;
};

export function subjectColor(id: string, mode: 'light' | 'dark' = 'dark'): SubjectColor {
  const hue = PALETTE[hashString(id) % PALETTE.length];
  const lightness = mode === 'dark' ? 66 : 40;
  const softLight = mode === 'dark' ? 22 : 88;
  return {
    hue: hue.hue,
    base: `hsl(${hue.hue} ${hue.sat}% ${lightness}%)`,
    soft: `hsl(${hue.hue} ${hue.sat}% ${softLight}%)`,
    text: `hsl(${hue.hue} ${hue.sat}% ${mode === 'dark' ? 78 : 26}%)`,
  };
}
