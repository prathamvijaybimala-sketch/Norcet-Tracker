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

/**
 * Hash a password for storage. Always resolves (never throws).
 *
 * The stored value is TAGGED with the algorithm that produced it
 * (`s:` = SHA-256, `f:` = FNV fallback): the available algorithm is
 * environment-dependent, and comparing a SHA-256 hash against an FNV hash
 * would silently say "wrong password". Legacy untagged hashes (from before
 * the tag) are still accepted when verifying, so existing locks keep
 * working on the same device.
 */
export async function hashPlanPassword(password: string): Promise<string> {
  const hex = await sha256Hex(`${SALT}:${password}`);
  return hex ? `s:${hex}` : `f:${fnvStretchHex(`${SALT}:${password}`)}`;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Compare a stored hash with a freshly computed one. Tolerates legacy
 * untagged stored values (compared as raw digests on the same device, where
 * the algorithm is the same one that created them).
 */
export function sameHash(stored: string, candidate: string): boolean {
  const cIdx = candidate.indexOf(':');
  const cAlg = cIdx === 1 ? candidate.slice(0, 1) : '';
  const cDigest = cIdx === 1 ? candidate.slice(2) : candidate;

  const sIdx = stored.indexOf(':');
  const sAlg = sIdx === 1 ? stored.slice(0, 1) : '';
  const sDigest = sIdx === 1 ? stored.slice(2) : stored;

  if (sAlg) return sAlg === cAlg && constantTimeEquals(sDigest, cDigest);
  // Legacy untagged stored hash: same device, same algorithm as at set-time.
  return constantTimeEquals(sDigest, cDigest);
}

/** Minimum length enforced when setting / changing the lock. */
export const MIN_LOCK_LENGTH = 4;
