/**
 * Stable id generation.
 *
 * The source curriculum has no ids, so ids are derived from *names* (never from
 * array indexes) so that re-importing the same file after new lectures have been
 * appended upstream keeps every existing id - and therefore every progress
 * record - attached to the right lecture.
 */

/** Lowercase, strip punctuation/accents, collapse whitespace to `-`. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // drop combining accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'x' // never return an empty slug
  );
}

/**
 * Makes a unique-key function that appends `-2`, `-3`, ... on collision.
 * Deterministic for a given insertion order, and stable as long as the file's
 * ordering of *distinct names* is stable.
 */
export function createIdFactory(): (key: string) => string {
  const seen = new Map<string, number>();
  return (key: string) => {
    const count = seen.get(key);
    if (count === undefined) {
      seen.set(key, 1);
      return key;
    }
    const next = count + 1;
    seen.set(key, next);
    return `${key}--${next}`;
  };
}
