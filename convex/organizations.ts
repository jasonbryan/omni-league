import { v, type Infer } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { isSlug } from './lib/slugs';
import { sportName } from './lib/sports';

/** Most locations and leagues a public page lists; the reads stay bounded. */
export const PUBLIC_PAGE_LIMIT = 200;

/** Everything the public organization page shows, and nothing else (no ids, staff, or payments). */
export const publicPageValidator = v.object({
  name: v.string(),
  slug: v.string(),
  locations: v.array(v.object({ name: v.string(), address: v.string() })),
  leagues: v.array(
    v.object({
      name: v.string(),
      sportName: v.string(),
      locationNames: v.array(v.string()),
    }),
  ),
});

export type PublicPage = Infer<typeof publicPageValidator>;

/**
 * The public page of the organization with this slug, or `null` when there is none (#60).
 *
 * Deliberately public (convex.md, Functions): visitors and crawlers read it without signing in,
 * and the server render calls it anonymously. It reads no identity, so every caller gets the same
 * result, and returns only the fields of `publicPageValidator`. #66 adds the draft filter: leagues
 * stay off this page until they are published.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (ADR 0002): an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { slug: v.string() },
  returns: v.union(v.null(), publicPageValidator),
  handler: async (ctx, { slug }) => {
    if (!isSlug(slug)) return null;
    const organization = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .unique();
    if (!organization) return null;

    const locations = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organization._id))
      .take(PUBLIC_PAGE_LIMIT);
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_name', (q) => q.eq('organizationId', organization._id))
      .take(PUBLIC_PAGE_LIMIT);

    // Only this organization's locations: a league can never name another organization's.
    const locationName = new Map(locations.map((location) => [location._id, location.name]));
    return {
      name: organization.name,
      slug: organization.slug,
      locations: byName(locations).map(({ name, address }) => ({ name, address })),
      leagues: byName(leagues).map((league) => ({
        name: league.name,
        sportName: sportName(league.sport),
        locationNames: league.locationIds.flatMap((id) => {
          const name = locationName.get(id);
          return name === undefined ? [] : [name];
        }),
      })),
    };
  },
});

/**
 * Sorted by name ignoring case, then by the exact name, then by creation. The index orders by
 * code point, which would put "adult league" after "Zebra League".
 */
function byName<D extends Doc<'locations'> | Doc<'leagues'>>(docs: D[]): D[] {
  const key = (doc: D) => doc.name.toLowerCase();
  return [...docs].sort(
    (a, b) =>
      compare(key(a), key(b)) || compare(a.name, b.name) || a._creationTime - b._creationTime,
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
