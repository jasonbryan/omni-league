import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireOrgAdmin, requireOrgAdminOrForbidden, requireUser } from './lib/access';
import { leagueDivisionLabel } from './lib/leagueDivision';
import { leagueRowSeasons } from './lib/publicLeague';
import { insertOrgAdminMembership } from './lib/memberships';
import {
  checkCityState,
  checkOrganizationName,
  checkOrganizationSlug,
  ORGANIZATION_MESSAGES,
  type OrganizationInputError,
} from './lib/organizationInput';
import {
  pageOf,
  pageRows,
  PUBLIC_LIST_MAX_PAGE,
  PUBLIC_LIST_MAX_ROWS,
  PUBLIC_LIST_PAGE_SIZE,
} from './lib/publicList';
import {
  getPublicPageReturns,
  publicLeaguesValidator,
  publicLocationsValidator,
  type PublicLeagues,
  type PublicLocations,
} from './lib/publicPage';
import { roleValidator } from './lib/roles';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { SPORT_NAMES, sportName, sportSegment, sportValidator, type Sport } from './lib/sports';
import {
  insertOrganization,
  organizationSlugTaken,
  sortName,
  updateOrganizationCityState,
} from './lib/tenantWrites';
import { getCurrentUser } from './lib/users';

export { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE };

const listArgs = { slug: v.string(), page: v.number() };

const EMPTY_LIST = { rows: [], page: 1, pageCount: 0, total: 0 };

async function sportNamesAt(
  ctx: QueryCtx,
  organizationId: Id<'organizations'>,
  locationId: Id<'locations'>,
): Promise<string[]> {
  const names: string[] = [];
  for (const sport of Object.keys(SPORT_NAMES) as Sport[]) {
    const row = await ctx.db
      .query('sportLocations')
      .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
        q.eq('organizationId', organizationId).eq('sport', sport).eq('locationId', locationId),
      )
      .unique();
    if (row && row.leagueCount > 0) names.push(sportName(sport));
  }
  return names;
}

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { slug: v.string() },
  returns: getPublicPageReturns,
  handler: async (ctx, { slug }) => {
    const organization = await findOrganizationBySlug(ctx, slug);
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
      ...(organization.cityState !== undefined && { cityState: organization.cityState }),
      leagueCount: organization.leagueCount ?? 0,
      locationCount: organization.locationCount ?? 0,
      sportCount: sports.length,
      sports,
    };
  },
});

async function locationsThroughPage(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  requestedPage: number,
): Promise<{ read: Doc<'locations'>[]; total: number }> {
  const total = organization.locationCount ?? 0;
  const { page } = pageOf(total, requestedPage);
  const read = await ctx.db
    .query('locations')
    .withIndex('by_organizationId_and_sortName', (q) => q.eq('organizationId', organization._id))
    .take(page * PUBLIC_LIST_PAGE_SIZE);
  return { read, total };
}

/** The index orders them by id, so they are read together (at most the most rows a list can reach) and sorted here. */
async function sportLocations(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  sport: Sport,
): Promise<{ read: Doc<'locations'>[]; total: number }> {
  const links = await ctx.db
    .query('sportLocations')
    .withIndex('by_organizationId_and_sport_and_locationId', (q) =>
      q.eq('organizationId', organization._id).eq('sport', sport),
    )
    .take(PUBLIC_LIST_MAX_ROWS);
  const read: Doc<'locations'>[] = [];
  for (const link of links) {
    if (link.leagueCount < 1) continue;
    const location = await ctx.db.get('locations', link.locationId);
    if (location?.organizationId === organization._id) read.push(location);
  }
  const key = (location: Doc<'locations'>) => location.sortName ?? sortName(location.name);
  read.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { read, total: read.length };
}

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listPublicLocations = query({
  args: { ...listArgs, sport: v.optional(sportValidator) },
  returns: publicLocationsValidator,
  handler: async (ctx, args): Promise<PublicLocations> => {
    const organization = await findOrganizationBySlug(ctx, args.slug);
    if (!organization) return EMPTY_LIST;
    const { sport } = args;
    const { read, total } =
      sport === undefined
        ? await locationsThroughPage(ctx, organization, args.page)
        : await sportLocations(ctx, organization, sport);
    const { page, pageCount } = pageOf(total, args.page);
    const rows = [];
    for (const location of pageRows(read.slice(0, page * PUBLIC_LIST_PAGE_SIZE), page)) {
      rows.push({
        name: location.name,
        address: location.address,
        sportNames: await sportNamesAt(ctx, organization._id, location._id),
      });
    }
    return { rows, page, pageCount, total };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listPublicLeagues = query({
  args: { ...listArgs, sport: v.optional(sportValidator) },
  returns: publicLeaguesValidator,
  handler: async (ctx, args): Promise<PublicLeagues> => {
    const organization = await findOrganizationBySlug(ctx, args.slug);
    if (!organization) return EMPTY_LIST;
    const { sport } = args;
    const total =
      sport === undefined
        ? (organization.leagueCount ?? 0)
        : (organization.sportLeagueCounts?.[sport] ?? 0);
    const { page, pageCount } = pageOf(total, args.page);
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
      const label = await leagueDivisionLabel(ctx, league);
      const seasons = await leagueRowSeasons(ctx, league);
      rows.push({
        name: league.name,
        slug: league.slug,
        sportName: sportName(league.sport),
        locationNames,
        ...(label !== undefined && { divisionLabel: label }),
        seasons,
      });
    }
    return { rows, page, pageCount, total };
  },
});

export const getAdminContext = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      organizationId: v.id('organizations'),
      name: v.string(),
      slug: v.string(),
      cityState: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const organization = await findOrganizationBySlug(ctx, slug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    await requireOrgAdminOrForbidden(ctx, organization._id);
    return {
      organizationId: organization._id,
      name: organization.name,
      slug: organization.slug,
      ...(organization.cityState !== undefined && { cityState: organization.cityState }),
    };
  },
});

export const LIST_MINE_LIMIT = 100;

export const LIST_MINE_LEAGUES_LIMIT = 100;

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

export const create = mutation({
  args: { name: v.string(), slug: v.string(), cityState: v.optional(v.string()) },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = checkOrganizationName(args.name);
    if (!name.ok) refuse(name.error);
    const cityState = checkCityState(args.cityState ?? '');
    if (!cityState.ok) refuse(cityState.error);
    const slugError = checkOrganizationSlug(args.slug);
    if (slugError) refuse(slugError);
    if (await organizationSlugTaken(ctx, args.slug)) {
      refuse({
        field: 'slug',
        code: 'slugTaken',
        message: ORGANIZATION_MESSAGES.slugTaken(args.slug),
      });
    }
    const organizationId = await insertOrganization(ctx, {
      name: name.name,
      slug: args.slug,
      cityState: cityState.value ?? undefined,
    });
    await insertOrgAdminMembership(ctx, user._id, organizationId);
    return { slug: args.slug };
  },
});

export const updateDetails = mutation({
  args: { organizationId: v.id('organizations'), cityState: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const cityState = checkCityState(args.cityState ?? '');
    if (!cityState.ok) refuse(cityState.error);
    await updateOrganizationCityState(ctx, args.organizationId, cityState.value);
    return null;
  },
});
