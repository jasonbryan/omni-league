import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import {
  getPublicPageReturns,
  publicLeaguesValidator,
  publicLocationsValidator,
} from './lib/publicPage';
import { isSlug } from './lib/slugs';
import { SPORT_NAMES, sportName, sportSegment, sportValidator, type Sport } from './lib/sports';

/** Rows per page of a public list (owner, #106). Never taken from args. */
export const PUBLIC_LIST_PAGE_SIZE = 5;

/**
 * The last page a public list serves, so one call reads at most 200 rows
 * (`PUBLIC_LIST_MAX_PAGE * PUBLIC_LIST_PAGE_SIZE`) whatever the args. Never taken from args.
 */
export const PUBLIC_LIST_MAX_PAGE = 40;

const listArgs = { slug: v.string(), page: v.number() };

const EMPTY_LIST = { rows: [], page: 1, pageCount: 0, total: 0 };

async function organizationBySlug(
  ctx: QueryCtx,
  slug: string,
): Promise<Doc<'organizations'> | null> {
  if (!isSlug(slug)) return null;
  return ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .unique();
}

/**
 * The page to serve and the number of pages, for a list of `total` rows. The requested page is
 * served when it is a whole number from 1 to the page count, and page 1 in every other case (0,
 * negative, fractional, `NaN`, past the last page, past `PUBLIC_LIST_MAX_PAGE`): the approved
 * mockup's rule (#106). So `page * PUBLIC_LIST_PAGE_SIZE` is at most 200.
 */
function pageOf(total: number, requested: number): { page: number; pageCount: number } {
  const pageCount = Math.min(Math.ceil(total / PUBLIC_LIST_PAGE_SIZE), PUBLIC_LIST_MAX_PAGE);
  const page =
    Number.isInteger(requested) && requested >= 1 && requested <= pageCount ? requested : 1;
  return { page, pageCount };
}

/** The rows of `page` out of the first `page * PUBLIC_LIST_PAGE_SIZE` rows read. */
function pageRows<D>(read: D[], page: number): D[] {
  return read.slice((page - 1) * PUBLIC_LIST_PAGE_SIZE);
}

/**
 * The public page header of the organization with this slug, or `null` when there is none (#60):
 * its name and slug, its league and location totals (#100), and its sports (#101): each sport
 * with at least one league, in `SPORT_NAMES` order, with its segment, name, and league and
 * location counts. `sportCount` is the number of sports. The lists are `listPublicLeagues` and
 * `listPublicLocations`.
 *
 * Deliberately public (convex.md, Functions): visitors and crawlers read it without signing in,
 * and the server render calls it anonymously. It reads no identity, so every caller gets the same
 * result, and returns only the fields of `publicPageValidator` (`lib/publicPage.ts`). Every count
 * is one of the organization's counters (a counter not yet backfilled reads as 0), so the query
 * reads one document. #66 adds the draft filter: leagues stay off this page until they are
 * published.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (ADR 0002): an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { slug: v.string() },
  // The app checks saved copies against this same validator (convex/lib/publicPage.ts, #82).
  returns: getPublicPageReturns,
  handler: async (ctx, { slug }) => {
    const organization = await organizationBySlug(ctx, slug);
    if (!organization) return null;
    const sports = [];
    for (const key of Object.keys(SPORT_NAMES) as Sport[]) {
      const leagueCount = organization.sportLeagueCounts?.[key] ?? 0;
      if (leagueCount < 1) continue;
      sports.push({
        key,
        segment: sportSegment(key),
        name: sportName(key),
        leagueCount,
        locationCount: organization.sportLocationCounts?.[key] ?? 0,
      });
    }
    return {
      name: organization.name,
      slug: organization.slug,
      leagueCount: organization.leagueCount ?? 0,
      locationCount: organization.locationCount ?? 0,
      sportCount: sports.length,
      sports,
    };
  },
});

/**
 * One page of the locations of the organization with this slug, sorted by name ignoring case
 * (#100): `PUBLIC_LIST_PAGE_SIZE` rows or fewer, the page served (see `pageOf`), the page count,
 * and the total, all from one snapshot. An unknown slug gives page 1 of 0. Public and anonymous
 * like `getPublicPage`; it returns no ids.
 *
 * Offset reads: page N reads the first `N * PUBLIC_LIST_PAGE_SIZE` rows of the index and returns
 * the last of them, so the reach is the first 200 rows (#100, Notes).
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (ADR 0002): an anonymous public page that reads no identity and returns only published fields.
export const listPublicLocations = query({
  args: listArgs,
  returns: publicLocationsValidator,
  handler: async (ctx, args) => {
    const organization = await organizationBySlug(ctx, args.slug);
    if (!organization) return EMPTY_LIST;
    const total = organization.locationCount ?? 0;
    const { page, pageCount } = pageOf(total, args.page);
    const read = await ctx.db
      .query('locations')
      .withIndex('by_organizationId_and_sortName', (q) => q.eq('organizationId', organization._id))
      .take(page * PUBLIC_LIST_PAGE_SIZE);
    return {
      rows: pageRows(read, page).map(({ name, address }) => ({ name, address })),
      page,
      pageCount,
      total,
    };
  },
});

/**
 * One page of the leagues of the organization with this slug, sorted by name ignoring case, with
 * each league's sport display name and location names (#100). Pages, totals, and access are as for
 * `listPublicLocations`. With `sport` (#101) it lists only that sport's leagues, from the sport
 * index, and its total is the organization's `sportLeagueCounts` for the sport (0 when it has no
 * league of that sport: an empty page 1). The page size, the page cap, and the effective-page
 * rule are the same. A league's locations are read by id, whatever page they are on; an id of
 * another organization's location is dropped.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public (ADR 0002): an anonymous public page that reads no identity and returns only published fields.
export const listPublicLeagues = query({
  args: { ...listArgs, sport: v.optional(sportValidator) },
  returns: publicLeaguesValidator,
  handler: async (ctx, args) => {
    const organization = await organizationBySlug(ctx, args.slug);
    if (!organization) return EMPTY_LIST;
    const { sport } = args;
    const total =
      sport === undefined
        ? (organization.leagueCount ?? 0)
        : (organization.sportLeagueCounts?.[sport] ?? 0);
    const { page, pageCount } = pageOf(total, args.page);
    // No league by the counter (also a counter not yet backfilled): an empty page, with no read.
    if (pageCount === 0) return EMPTY_LIST;
    const leagues =
      sport === undefined
        ? ctx.db
            .query('leagues')
            .withIndex('by_organizationId_and_sortName', (q) =>
              q.eq('organizationId', organization._id),
            )
        : ctx.db
            .query('leagues')
            .withIndex('by_organizationId_and_sport_and_sortName', (q) =>
              q.eq('organizationId', organization._id).eq('sport', sport),
            );
    const read = await leagues.take(page * PUBLIC_LIST_PAGE_SIZE);
    const rows = [];
    for (const league of pageRows(read, page)) {
      const locationNames: string[] = [];
      for (const id of league.locationIds) {
        const location = await ctx.db.get('locations', id);
        // Only this organization's locations: a league can never name another organization's.
        if (location?.organizationId === organization._id) locationNames.push(location.name);
      }
      rows.push({ name: league.name, sportName: sportName(league.sport), locationNames });
    }
    return { rows, page, pageCount, total };
  },
});
