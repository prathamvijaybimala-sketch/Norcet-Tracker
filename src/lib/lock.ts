/**
 * Plan-screen lock.
 *
 * The point of the lock is to stop accidental one-tap edits ("so she doesn't
 * change the plan on whims"), not to keep out a determined attacker, so the
 * password is stored as a salted SHA-256 hash on-device - never in plain
 * text - without pulling in a crypto dependency.
 *
 * WebCrypto's `crypto.subtle` is available in the Capacitor WebView (the app
 * serves over its `https` scheme, a secure context). In environments where it
 * is not (some desktop browsers on http, tests) we fall back to a slow
 * FNV-1a stretch hash so the behaviour stays deterministic everywhere.
 */

const SALT = 'norcet-tracker-plan-lock-v1';

async function sha256Hex(input: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** FNV-1a stretched 1000 rounds -> 8 hex chunks (32 chars). Not secure, but stable. */
function fnvStretchHex(input: string): string {
  let out = '';
  let h = 0x811c9dc5;
  for (let round = 0; round < 1000; round++) {
    const data = `${round}:${input}`;
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

/** Hash a password for storage. Always resolves (never throws). */
export async function hashPlanPassword(password: string): Promise<string> {
  const hex = await sha256Hex(`${SALT}:${password}`);
  return hex ?? fnvStretchHex(`${SALT}:${password}`);
}

/** Constant-time-ish comparison (timing does not matter here, but be tidy). */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Minimum length enforced when setting / changing the lock. */
export const MIN_LOCK_LENGTH = 4;
