/** Shortest slug accepted. */
export const MIN_SLUG_LENGTH = 3;

/** Longest slug accepted; organization and league slugs appear in public URLs. */
export const MAX_SLUG_LENGTH = 60;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Lowercase letters and digits in runs joined by single hyphens, `MIN_SLUG_LENGTH` to
 * `MAX_SLUG_LENGTH` characters. Says nothing about reserved slugs: the demo seeds and public pages
 * use some, so only `isChoosableSlug` refuses them.
 */
export function isSlug(value: string): boolean {
  return value.length >= MIN_SLUG_LENGTH && value.length <= MAX_SLUG_LENGTH && SLUG.test(value);
}

/**
 * The slugs of the demo organizations `seed:demo` inserts on previews and staging (#99). Reserved,
 * so a user-created organization can never receive demo rows on a reused preview.
 * `convex/seed.test.ts` checks that this list is the seed's.
 */
export const DEMO_ORGANIZATION_SLUGS: readonly string[] = [
  'gulf-coast-sport-social',
  'port-aransas-beach-volleyball-club',
  'front-range-rec-sports',
  'lakeshore-sand-league',
  'saguaro-valley-softball',
];

/**
 * Reserved slugs (glossary): no organization or league can be created with one. `new` is the
 * `/app/organizations/new` form, which shares its path with `/app/organizations/:slug` (#65), and
 * a later `leagues/new` (#66); the rest are the demo organizations. A reserved slug is refused
 * with the same message as a malformed one.
 */
export const RESERVED_SLUGS: readonly string[] = ['new', ...DEMO_ORGANIZATION_SLUGS];

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.includes(value);
}

/** A slug a user may choose for a new organization or league: valid and not reserved. */
export function isChoosableSlug(value: string): boolean {
  return isSlug(value) && !isReservedSlug(value);
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
