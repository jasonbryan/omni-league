/** Longest slug accepted; organization and league slugs appear in public URLs. */
export const MAX_SLUG_LENGTH = 64;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lowercase letters and digits in runs joined by single hyphens, at most 64 characters. */
export function isSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && SLUG.test(value);
}

/**
 * A slug made from a display name: accents dropped, other characters folded to hyphens. A name with
 * no letters or digits gives `item`. Callers make it unique within its scope.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug || 'item';
}
