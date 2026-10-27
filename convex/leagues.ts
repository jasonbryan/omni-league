import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  requireLeagueOrganizer,
  requireLeagueOrganizerOrForbidden,
  requireOrgAdmin,
} from './lib/access';
import { genderValidator, standardLevelValidator } from './lib/divisions';
import { leagueDivisionLabel } from './lib/leagueDivision';
import {
  checkLeagueAgeGroup,
  checkLeagueFormat,
  checkLeagueLevel,
  checkLeagueLocations,
  checkLeagueMinimumRosterSize,
  checkLeagueName,
  checkLeagueSlug,
  LEAGUE_MESSAGES,
  type LeagueInputError,
} from './lib/leagueInput';
import { leagueStatusValidator } from './lib/leagueStatus';
import { leagueLocationNames } from './lib/publicLeague';
import { getLeaguePublicPageReturns } from './lib/publicPage';
import { roleValidator } from './lib/roles';
import { findLeagueBySlugs } from './lib/seasonLookup';
import { sportName, sportValidator, type Sport } from './lib/sports';
import { insertDraftLeague, leagueSlugTaken, publishLeague } from './lib/tenantWrites';

export const ADMIN_LEAGUES_LIMIT = 200;

function refuse(error: LeagueInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

export const listForAdmin = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      leagueId: v.id('leagues'),
      name: v.string(),
      slug: v.string(),
      sportName: v.string(),
      status: leagueStatusValidator,
      locationNames: v.array(v.string()),
      divisionLabel: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const leagues = await ctx.db
      .query('leagues')
      .withIndex('by_organizationId_and_sortName', (q) => q.eq('organizationId', organizationId))
      .take(ADMIN_LEAGUES_LIMIT);
    const locationNames = new Map<Id<'locations'>, string | null>();
    const nameOf = async (id: Id<'locations'>): Promise<string | null> => {
      if (!locationNames.has(id)) {
        const location = await ctx.db.get('locations', id);
        locationNames.set(id, location?.organizationId === organizationId ? location.name : null);
      }
      return locationNames.get(id) ?? null;
    };
    const rows = [];
    for (const league of leagues) {
      const names: string[] = [];
      for (const id of league.locationIds) {
        const name = await nameOf(id);
        if (name !== null) names.push(name);
      }
      const label = await leagueDivisionLabel(ctx, league);
      rows.push({
        leagueId: league._id,
        name: league.name,
        slug: league.slug,
        sportName: sportName(league.sport),
        status: league.status ?? ('draft' as const),
        locationNames: names,
        ...(label !== undefined && { divisionLabel: label }),
      });
    }
    return rows;
  },
});

// A level of another organization or sport is refused as not allowed; one deleted meanwhile, as a Level error.
async function checkedCustomLevel(
  ctx: QueryCtx,
  organizationId: Id<'organizations'>,
  sport: Sport,
  customLevelId: Id<'customLevels'> | undefined,
): Promise<Doc<'customLevels'> | null> {
  if (customLevelId === undefined) return null;
  const customLevel = await ctx.db.get('customLevels', customLevelId);
  if (!customLevel) {
    refuse({ field: 'level', code: 'levelInvalid', message: LEAGUE_MESSAGES.levelInvalid });
  }
  if (customLevel.organizationId !== organizationId || customLevel.sport !== sport) {
    throw new Error('Not allowed');
  }
  return customLevel;
}

export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    name: v.string(),
    slug: v.string(),
    sport: sportValidator,
    locationIds: v.array(v.id('locations')),
    gender: genderValidator,
    playersPerSide: v.number(),
    level: standardLevelValidator,
    customLevelId: v.optional(v.id('customLevels')),
    // A string, not the age group validator, so an unknown value is refused with the field's error.
    ageGroup: v.string(),
    minimumRosterSize: v.optional(v.number()),
  },
  returns: v.object({ leagueId: v.id('leagues') }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const name = checkLeagueName(args.name);
    if (!name.ok) refuse(name.error);
    const slugError = checkLeagueSlug(args.slug);
    if (slugError) refuse(slugError);
    const formatError = checkLeagueFormat(args.sport, args.playersPerSide);
    if (formatError) refuse(formatError);
    const minimumError = checkLeagueMinimumRosterSize(args.playersPerSide, args.minimumRosterSize);
    if (minimumError) refuse(minimumError);
    const levelError = checkLeagueLevel(args.sport, args.level);
    if (levelError) refuse(levelError);
    const customLevel = await checkedCustomLevel(
      ctx,
      args.organizationId,
      args.sport,
      args.customLevelId,
    );
    const ageGroup = checkLeagueAgeGroup(args.ageGroup);
    if (!ageGroup.ok) refuse(ageGroup.error);
    const locationIds = [...new Set(args.locationIds)];
    const locationsError = checkLeagueLocations(locationIds.length);
    if (locationsError) refuse(locationsError);
    for (const id of locationIds) {
      const location = await ctx.db.get('locations', id);
      if (location?.organizationId !== args.organizationId) throw new Error('Not allowed');
    }
    if (await leagueSlugTaken(ctx, args.organizationId, args.slug)) {
      refuse({
        field: 'slug',
        code: 'slugTaken',
        message: LEAGUE_MESSAGES.slugTaken(args.slug),
      });
    }
    const leagueId = await insertDraftLeague(ctx, args.organizationId, {
      name: name.name,
      slug: args.slug,
      sport: args.sport,
      locationIds,
      division: {
        gender: args.gender,
        playersPerSide: args.playersPerSide,
        level: customLevel?.standardLevel ?? args.level,
        ...(customLevel && { customLevelId: customLevel._id }),
        ageGroup: ageGroup.ageGroup,
        ...(args.minimumRosterSize !== undefined && {
          minimumRosterSize: args.minimumRosterSize,
        }),
      },
    });
    return { leagueId };
  },
});

export const publish = mutation({
  args: { leagueId: v.id('leagues') },
  returns: v.null(),
  handler: async (ctx, { leagueId }) => {
    await requireLeagueOrganizer(ctx, leagueId);
    const league = await ctx.db.get('leagues', leagueId);
    if (!league) throw new Error('Not allowed');
    await publishLeague(ctx, league);
    return null;
  },
});

export const publishedCount = query({
  args: { organizationId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const organization = await ctx.db.get('organizations', organizationId);
    return organization?.leagueCount ?? 0;
  },
});

export const getOrganizerContext = query({
  args: { orgSlug: v.string(), leagueSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      leagueId: v.id('leagues'),
      name: v.string(),
      slug: v.string(),
      sport: sportValidator,
      status: leagueStatusValidator,
      locationNames: v.array(v.string()),
      role: roleValidator,
      organization: v.object({ name: v.string(), slug: v.string() }),
    }),
  ),
  handler: async (ctx, args) => {
    const found = await findLeagueBySlugs(ctx, args);
    if (!found) return null;
    const { organization, league } = found;
    const access = await requireLeagueOrganizerOrForbidden(ctx, league);
    if (!access) return null;
    const locationNames: string[] = [];
    for (const id of league.locationIds) {
      const location = await ctx.db.get('locations', id);
      if (location?.organizationId === organization._id) locationNames.push(location.name);
    }
    return {
      leagueId: league._id,
      name: league.name,
      slug: league.slug,
      sport: league.sport,
      status: league.status ?? ('draft' as const),
      locationNames,
      role: access.membership.role,
      organization: { name: organization.name, slug: organization.slug },
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { orgSlug: v.string(), leagueSlug: v.string() },
  returns: getLeaguePublicPageReturns,
  handler: async (ctx, args) => {
    const found = await findLeagueBySlugs(ctx, args);
    // A draft answers like an unknown league, so nothing public says whether its slug exists.
    if (found?.league.status !== 'published') return null;
    const { organization, league } = found;
    return {
      organization: { name: organization.name, slug: organization.slug },
      name: league.name,
      slug: league.slug,
      sportName: sportName(league.sport),
      locationNames: await leagueLocationNames(ctx, organization, league),
    };
  },
});
