export const MIN_SLUG_LENGTH = 3;

export const MAX_SLUG_LENGTH = 60;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Does not refuse reserved slugs: the demo seeds use some, so only `isChoosableSlug` does.
export function isSlug(value: string): boolean {
  return value.length >= MIN_SLUG_LENGTH && value.length <= MAX_SLUG_LENGTH && SLUG.test(value);
}

// Reserved, so a user-created organization never receives demo rows on a reused preview.
export const DEMO_ORGANIZATION_SLUGS: readonly string[] = [
  'gulf-coast-sport-social',
  'port-aransas-beach-volleyball-club',
  'front-range-rec-sports',
  'lakeshore-sand-league',
  'saguaro-valley-softball',
  'rockport-sand-volleyball',
];

// `new` shares its path with `/app/organizations/:slug`.
export const RESERVED_SLUGS: readonly string[] = ['new', ...DEMO_ORGANIZATION_SLUGS];

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.includes(value);
}

export function isChoosableSlug(value: string): boolean {
  return isSlug(value) && !isReservedSlug(value);
}

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
