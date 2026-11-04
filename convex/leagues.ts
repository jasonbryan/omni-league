import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  requireLeagueOrganizer,
  requireLeagueOrganizerOrForbidden,
  requireOrgAdmin,
} from './lib/access';
import {
  ageGroupValidator,
  genderValidator,
  isPlayersPerSideOfSport,
  standardLevelValidator,
  type Gender,
  type StandardLevel,
} from './lib/divisions';
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
import { logoUrlField } from './lib/organizationLogo';
import { leaguePageSeasons, leagueLocations } from './lib/publicLeague';
import { getLeaguePublicPageReturns, type PublicLeaguePage } from './lib/publicPage';
import { roleValidator } from './lib/roles';
import { findLeagueBySlugs } from './lib/seasonLookup';
import { ROSTER_SIZE_INPUT_MAX, sportName, sportValidator, type Sport } from './lib/sports';
import {
  draftSeasonEarlierValidator,
  insertDraftLeague,
  leagueEarlierValidator,
  leagueHolds,
  leagueSlugTaken,
  leagueUpdateEarlierValidator,
  leagueWrittenValidator,
  type LeagueEarlier,
  MAX_DRAFT_SEASONS_UPDATED,
  publishLeague,
  restoreLeague,
  updateLeague,
  type LeagueDivision,
} from './lib/tenantWrites';

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

interface DivisionInput {
  gender: Gender;
  playersPerSide: number;
  level: StandardLevel;
  customLevelId?: Id<'customLevels'> | undefined;
  ageGroup: string;
  minimumRosterSize?: number | undefined;
}

async function checkedDivision(
  ctx: QueryCtx,
  organizationId: Id<'organizations'>,
  sport: Sport,
  input: DivisionInput,
): Promise<LeagueDivision> {
  const formatError = checkLeagueFormat(sport, input.playersPerSide);
  if (formatError) refuse(formatError);
  const minimumError = checkLeagueMinimumRosterSize(input.playersPerSide, input.minimumRosterSize);
  if (minimumError) refuse(minimumError);
  const levelError = checkLeagueLevel(sport, input.level);
  if (levelError) refuse(levelError);
  const customLevel = await checkedCustomLevel(ctx, organizationId, sport, input.customLevelId);
  const ageGroup = checkLeagueAgeGroup(input.ageGroup);
  if (!ageGroup.ok) refuse(ageGroup.error);
  return {
    gender: input.gender,
    playersPerSide: input.playersPerSide,
    level: customLevel?.standardLevel ?? input.level,
    ...(customLevel && { customLevelId: customLevel._id }),
    ageGroup: ageGroup.ageGroup,
    ...(input.minimumRosterSize !== undefined && { minimumRosterSize: input.minimumRosterSize }),
  };
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
    const division = await checkedDivision(ctx, args.organizationId, args.sport, args);
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
      division,
    });
    return { leagueId };
  },
});

export const update = mutation({
  args: {
    leagueId: v.id('leagues'),
    name: v.string(),
    gender: genderValidator,
    playersPerSide: v.number(),
    level: standardLevelValidator,
    customLevelId: v.optional(v.id('customLevels')),
    // A string, not the age group validator, so an unknown value is refused with the field's error.
    ageGroup: v.string(),
    minimumRosterSize: v.optional(v.number()),
    // What the form last showed, so a save made from out-of-date details is refused. A previous release's tab sends none.
    expected: v.optional(leagueEarlierValidator),
  },
  returns: leagueUpdateEarlierValidator,
  handler: async (ctx, { leagueId, name: typedName, expected, ...input }) => {
    const { league } = await requireLeagueOrganizer(ctx, leagueId);
    if (expected) {
      const division = await organizerDivision(ctx, league);
      if (!organizerShows(expected, league.name, division)) {
        throw new ConvexError({
          field: 'name',
          code: 'changedSince',
          message: LEAGUE_MESSAGES.changedWhileEditing,
          current: { name: league.name, ...(division && { division }) },
        });
      }
    }
    const name = checkLeagueName(typedName);
    if (!name.ok) refuse(name.error);
    const division = await checkedDivision(ctx, league.organizationId, league.sport, input);
    return updateLeague(ctx, league, { name: name.name, division });
  },
});

export const undoUpdate = mutation({
  args: {
    leagueId: v.id('leagues'),
    league: leagueEarlierValidator,
    draftSeasons: v.array(draftSeasonEarlierValidator),
    written: leagueWrittenValidator,
  },
  returns: v.null(),
  handler: async (ctx, { leagueId, league: values, draftSeasons, written }) => {
    const { league } = await requireLeagueOrganizer(ctx, leagueId);
    if (!leagueHolds(league, written)) {
      refuse({ field: 'name', code: 'changedSince', message: LEAGUE_MESSAGES.changedSince });
    }
    // What `update` returned always passes these checks, so a failure is a caller sending its own values.
    const name = checkLeagueName(values.name);
    if (!name.ok || draftSeasons.length > MAX_DRAFT_SEASONS_UPDATED) throw new Error('Not allowed');
    const { gender, playersPerSide, level, ageGroup, customLevelId, minimumRosterSize } = values;
    // A league without a division cannot be put back to one, so no screen lets a save strip it.
    if (gender === undefined || playersPerSide === undefined || level === undefined) {
      throw new Error('Not allowed');
    }
    if (ageGroup === undefined) throw new Error('Not allowed');
    await checkedDivision(ctx, league.organizationId, league.sport, {
      gender,
      playersPerSide,
      level,
      ageGroup,
      customLevelId,
      minimumRosterSize,
    });
    for (const season of draftSeasons) {
      if (
        !isPlayersPerSideOfSport(league.sport, season.playersPerSide) ||
        !Number.isInteger(season.minimumRosterSize) ||
        season.minimumRosterSize < season.playersPerSide ||
        season.minimumRosterSize > ROSTER_SIZE_INPUT_MAX
      ) {
        throw new Error('Not allowed');
      }
    }
    await restoreLeague(ctx, league, {
      league: { ...values, name: name.name },
      draftSeasons,
      written,
    });
    return null;
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

const organizerDivisionValidator = v.object({
  gender: genderValidator,
  playersPerSide: v.number(),
  level: standardLevelValidator,
  customLevel: v.optional(v.object({ customLevelId: v.id('customLevels'), name: v.string() })),
  ageGroup: ageGroupValidator,
  minimumRosterSize: v.optional(v.number()),
  label: v.string(),
});

// A league not yet backfilled with a division has none.
async function organizerDivision(ctx: QueryCtx, league: Doc<'leagues'>) {
  const { gender, playersPerSide, level, ageGroup } = league;
  const label = await leagueDivisionLabel(ctx, league);
  if (
    gender === undefined ||
    playersPerSide === undefined ||
    level === undefined ||
    ageGroup === undefined ||
    label === undefined
  ) {
    return null;
  }
  const customLevel =
    league.customLevelId === undefined
      ? null
      : await ctx.db.get('customLevels', league.customLevelId);
  const ownCustomLevel =
    customLevel?.organizationId === league.organizationId && customLevel.sport === league.sport
      ? customLevel
      : null;
  return {
    gender,
    playersPerSide,
    level,
    ...(ownCustomLevel && {
      customLevel: { customLevelId: ownCustomLevel._id, name: ownCustomLevel.name },
    }),
    ageGroup,
    ...(league.minimumRosterSize !== undefined && { minimumRosterSize: league.minimumRosterSize }),
    label,
  };
}

// Compares what the organizer's page shows, so a custom level the page never shows cannot lock a save out.
function organizerShows(
  expected: LeagueEarlier,
  name: string,
  division: Awaited<ReturnType<typeof organizerDivision>>,
): boolean {
  return (
    expected.name === name &&
    expected.gender === division?.gender &&
    expected.playersPerSide === division?.playersPerSide &&
    expected.level === division?.level &&
    expected.customLevelId === division?.customLevel?.customLevelId &&
    expected.ageGroup === division?.ageGroup &&
    expected.minimumRosterSize === division?.minimumRosterSize
  );
}

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
      organizationId: v.id('organizations'),
      division: v.optional(organizerDivisionValidator),
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
    const division = await organizerDivision(ctx, league);
    return {
      leagueId: league._id,
      name: league.name,
      slug: league.slug,
      sport: league.sport,
      status: league.status ?? ('draft' as const),
      locationNames,
      role: access.membership.role,
      organization: { name: organization.name, slug: organization.slug },
      organizationId: organization._id,
      ...(division && { division }),
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { orgSlug: v.string(), leagueSlug: v.string() },
  returns: getLeaguePublicPageReturns,
  handler: async (ctx, args): Promise<PublicLeaguePage | null> => {
    const found = await findLeagueBySlugs(ctx, args);
    // A draft answers like an unknown league, so nothing public says whether its slug exists.
    if (found?.league.status !== 'published') return null;
    const { organization, league } = found;
    const locations = await leagueLocations(ctx, organization, league);
    const divisionLabel = await leagueDivisionLabel(ctx, league);
    return {
      organization: {
        name: organization.name,
        slug: organization.slug,
        ...(await logoUrlField(ctx, organization)),
      },
      name: league.name,
      slug: league.slug,
      sportName: sportName(league.sport),
      ...(divisionLabel !== undefined && { divisionLabel }),
      locationNames: locations.map((location) => location.name),
      locations,
      seasons: await leaguePageSeasons(ctx, league),
    };
  },
});
