import { describe, expect, it } from 'vitest';
import { hashPlanPassword, sameHash, MIN_LOCK_LENGTH } from '../src/lib/lock';

describe('plan lock hashing', () => {
  it('is deterministic', async () => {
    const a = await hashPlanPassword('nurse123');
    const b = await hashPlanPassword('nurse123');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it('differs for different passwords (even similar ones)', async () => {
    const a = await hashPlanPassword('nurse123');
    const b = await hashPlanPassword('nurse124');
    expect(a).not.toBe(b);
  });

  it('never returns the password itself', async () => {
    const hash = await hashPlanPassword('nurse123');
    expect(hash).not.toContain('nurse123');
  });

  it('sameHash is strict', async () => {
    const a = await hashPlanPassword('nurse123');
    expect(sameHash(a, a)).toBe(true);
    expect(sameHash(a, 'x'.repeat(a.length))).toBe(false);
    expect(sameHash(a, a.slice(0, -1))).toBe(false);
  });

  it('enforces a minimum length', () => {
    expect(MIN_LOCK_LENGTH).toBeGreaterThanOrEqual(4);
  });

  it('tags the stored hash with its algorithm (environment-independent)', async () => {
    const hash = await hashPlanPassword('nurse123');
    // "s:" = SHA-256, "f:" = FNV fallback - the tag records which one ran so
    // a hash from one environment is never compared against another.
    expect(hash).toMatch(/^[sf]:[0-9a-f]+$/);
  });

  it('still verifies legacy untagged hashes from the same device', async () => {
    const tagged = await hashPlanPassword('nurse123');
    const legacyDigest = tagged.slice(2); // what older versions stored raw
    expect(sameHash(legacyDigest, tagged)).toBe(true);
    expect(sameHash(legacyDigest, await hashPlanPassword('nurse124'))).toBe(false);
    // And a foreign tagged hash (different algorithm) is rejected.
    const other = `x:${tagged.slice(2)}`;
    expect(sameHash(other, tagged)).toBe(false);
  });
});
