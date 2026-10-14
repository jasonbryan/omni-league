import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireOrgAdminOrForbidden, requireUser } from './lib/access';
import { insertOrgAdminMembership } from './lib/memberships';
import {
  checkOrganizationName,
  checkOrganizationSlug,
  ORGANIZATION_MESSAGES,
} from './lib/organizationInput';
import { pageOf, pageRows, PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
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
import { refuse } from './lib/refuse';

export { PUBLIC_LIST_MAX_PAGE, PUBLIC_LIST_PAGE_SIZE };

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

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { slug: v.string() },
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

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
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

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
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
      rows.push({
        name: league.name,
        slug: league.slug,
        sportName: sportName(league.sport),
        locationNames,
      });
    }
    return { rows, page, pageCount, total };
  },
});

export const getAdminContext = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({ organizationId: v.id('organizations'), name: v.string(), slug: v.string() }),
  ),
  handler: async (ctx, { slug }) => {
    const organization = await organizationBySlug(ctx, slug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    await requireOrgAdminOrForbidden(ctx, organization._id);
    return { organizationId: organization._id, name: organization.name, slug: organization.slug };
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
