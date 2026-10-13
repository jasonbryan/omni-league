import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireOrgAdminOrForbidden, requireUser } from './lib/access';
import { insertOrgAdminMembership } from './lib/memberships';
import {
  checkOrganizationName,
  checkOrganizationSlug,
  ORGANIZATION_MESSAGES,
  type OrganizationInputError,
} from './lib/organizationInput';
import {
  getPublicPageReturns,
  publicLeaguesValidator,
  publicLocationsValidator,
} from './lib/publicPage';
import { roleValidator } from './lib/roles';
import { isSlug } from './lib/slugs';
import { SPORT_NAMES, sportName, sportSegment, sportValidator, type Sport } from './lib/sports';
import { insertOrganization, organizationSlugTaken, sortName } from './lib/tenantWrites';
import { getCurrentUser } from './lib/users';

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
 * reads one document. Only published leagues are counted (#66): a draft changes no counter, so it
 * stays off this page until it is published.
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
 * each league's sport display name and location names (#100). Only published leagues are listed
 * and counted (#66): the indexes include the status and the query reads `published`, so drafts never take a place in
 * the 200-row reach. Pages, totals, and access are as for
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
            .withIndex('by_organizationId_and_status_and_sortName', (q) =>
              q.eq('organizationId', organization._id).eq('status', 'published'),
            )
        : ctx.db
            .query('leagues')
            .withIndex('by_organizationId_and_sport_and_status_and_sortName', (q) =>
              q.eq('organizationId', organization._id).eq('sport', sport).eq('status', 'published'),
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

/**
 * The admin area's first query (#65), asked before anything else in it: the organization with this
 * slug as `{ organizationId, name, slug }` when the caller is one of its org admins, `null` for an
 * unknown slug (whoever asks: the organization's public page already shows it exists), and a
 * `FORBIDDEN` `ConvexError` (`lib/forbidden.ts`) for every other caller, including a league
 * organizer, a member of none, and a caller who is not signed in. The app shows the not-found view
 * for `null` and the no-access view for `FORBIDDEN`, and requests nothing else until it passes.
 */
export const getAdminContext = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({ organizationId: v.id('organizations'), name: v.string(), slug: v.string() }),
  ),
  handler: async (ctx, { slug }) => {
    const organization = await organizationBySlug(ctx, slug);
    if (!organization) return null;
    await requireOrgAdminOrForbidden(ctx, organization._id);
    return { organizationId: organization._id, name: organization.name, slug: organization.slug };
  },
});

/** Memberships `listMine` reads. A user is rarely in more than a few organizations. */
export const LIST_MINE_LIMIT = 100;

/**
 * Assigned leagues `listMine` reads in all (#141, #196): one budget across every membership, spent
 * in organization-name order, so a caller in several organizations costs no more than this many
 * league reads. An organization the budget does not reach lists no leagues.
 */
export const LIST_MINE_LEAGUES_LIMIT = 100;

/**
 * The leagues assigned to a league organizer in their organization, as `{ name, slug }` sorted by
 * the league's `sortName` (#100), drafts included (#141). An id whose league is missing, or belongs
 * to another organization, is dropped; a repeated id is listed once. An org admin has none: they
 * reach every league through the admin area. Reads at most `budget` leagues (the first ids of the
 * membership) and returns how many it read, so the caller can spend one budget across memberships.
 */
async function assignedLeagues(
  ctx: QueryCtx,
  membership: Doc<'memberships'>,
  budget: number,
): Promise<{ leagues: { name: string; slug: string }[]; reads: number }> {
  if (membership.role !== 'leagueOrganizer') return { leagues: [], reads: 0 };
  const ids = [...new Set(membership.leagueIds)].slice(0, budget);
  const leagues = [];
  for (const leagueId of ids) {
    const league = await ctx.db.get('leagues', leagueId);
    if (league?.organizationId !== membership.organizationId) continue;
    leagues.push({
      name: league.name,
      slug: league.slug,
      sortKey: league.sortName ?? sortName(league.name),
    });
  }
  leagues.sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0));
  return { leagues: leagues.map(({ name, slug }) => ({ name, slug })), reads: ids.length };
}

/**
 * "Your organizations" on `/app` (#64): the caller's own memberships as
 * `{ name, slug, role, leagues }`, sorted by organization name ignoring case. `leagues` (#141) is
 * the caller's assigned leagues in the organization when they are a league organizer, drafts
 * included, sorted by name ignoring case, and `[]` for an org admin. It takes no argument, so no
 * caller can name another user; with no identity, or an identity with no `users` row, it returns
 * `[]`. Reads at most `LIST_MINE_LIMIT` memberships and `LIST_MINE_LEAGUES_LIMIT` leagues in all
 * (#196), spent in organization-name order.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- the caller's own memberships only, found from ctx.auth (getCurrentUser); no argument names a user, and an anonymous caller gets [].
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      name: v.string(),
      slug: v.string(),
      role: roleValidator,
      leagues: v.array(v.object({ name: v.string(), slug: v.string() })),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_userId_and_organizationId', (q) => q.eq('userId', user._id))
      .take(LIST_MINE_LIMIT);
    const organizations = [];
    for (const membership of memberships) {
      const organization = await ctx.db.get('organizations', membership.organizationId);
      if (organization) organizations.push({ membership, organization });
    }
    // The order the rows come back in, so the league budget goes to the first rows.
    organizations.sort((x, y) => {
      const a = sortName(x.organization.name);
      const b = sortName(y.organization.name);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    let budget = LIST_MINE_LEAGUES_LIMIT;
    const rows = [];
    for (const { membership, organization } of organizations) {
      const { leagues, reads } = await assignedLeagues(ctx, membership, budget);
      budget -= reads;
      rows.push({
        name: organization.name,
        slug: organization.slug,
        role: membership.role,
        leagues,
      });
    }
    return rows;
  },
});

function refuse(error: OrganizationInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

/**
 * Creates an organization and makes the caller its first org admin, in one transaction (#64). Any
 * signed-in user may call it (owner, 2026-10-09). The name is trimmed and must be 1 to 100
 * characters; the slug must be valid, not reserved, and free (`convex/lib/organizationInput.ts`,
 * the rules and messages the form checks too). A refusal about a field is a `ConvexError` whose
 * data is the `OrganizationInputError`; nothing is written. The organization is inserted through
 * `tenantWrites`, so its counters exist from the first write. Returns the slug, where the public
 * page is.
 */
export const create = mutation({
  args: { name: v.string(), slug: v.string() },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = checkOrganizationName(args.name);
    if (!name.ok) refuse(name.error);
    const slugError = checkOrganizationSlug(args.slug);
    if (slugError) refuse(slugError);
    if (await organizationSlugTaken(ctx, args.slug)) {
      refuse({
        field: 'slug',
        code: 'slugTaken',
        message: ORGANIZATION_MESSAGES.slugTaken(args.slug),
      });
    }
    const organizationId = await insertOrganization(ctx, { name: name.name, slug: args.slug });
    await insertOrgAdminMembership(ctx, user._id, organizationId);
    return { slug: args.slug };
  },
});
