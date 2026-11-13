import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  requireOrgAdmin,
  requireUser,
  requireProgramOrganizer,
  requireProgramOrganizerOrForbidden,
  requireTournamentOrganizer,
  requireStaffOrForbidden,
} from './lib/access';
import { getCurrentUser } from './lib/users';
import { adultEntryInTournament } from './lib/rosterWrites';
import { isChoosableSlug, slugify } from './lib/slugs';
import { ageGroupValidator, genderValidator, standardLevelValidator } from './lib/divisions';
import { leagueDivisionLabel } from './lib/leagueDivision';
import {
  divisionFilterArgs,
  hasDivisionFilters,
  matchesDivisionFilters,
  scopedFilters,
  type DivisionFilters,
} from './lib/leagueFilters';
import { programStatusValidator } from './lib/programs';
import { leagueLocations } from './lib/publicLeague';
import { pageOf, pageRows, PUBLIC_LIST_MAX_ROWS, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import {
  getTournamentPublicPageReturns,
  publicOpenTournamentsValidator,
  publicTournamentsValidator,
  type PublicOpenTournaments,
  type PublicTournaments,
  type PublicTournamentPage,
} from './lib/publicPage';
import { dateAtUtcMinus12 } from './lib/registration';
import { roleValidator } from './lib/roles';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { tournamentDetailsValidator } from './lib/tournamentDetails';
import {
  findTournamentBySlugs,
  tournamentDetails,
  tournamentSlugsValidator,
} from './lib/tournamentLookup';
import { sportName, sportValidator, type Sport } from './lib/sports';
import {
  editableOf,
  sameEditable,
  DEFAULT_SETS_PER_GAME,
  setsPerGameIsChosen,
  setsPerGameValidator,
  tournamentEditableValidator,
  type TournamentEditable,
} from './lib/tournamentEdit';
import {
  checkTournamentDetails,
  checkTournamentFields,
  firstTournamentError,
  tournamentIsFull,
  TOURNAMENT_MESSAGES,
  type TournamentInputError,
} from './lib/tournamentInput';
import {
  insertDraftTournament,
  leagueSlugTaken,
  nextFreeSlug,
  publishTournament,
  updateTournamentDetails,
} from './lib/tenantWrites';

export const ADMIN_TOURNAMENTS_LIMIT = 200;

export const OPEN_TOURNAMENTS_READ_LIMIT = 50;

const EMPTY_LIST = { rows: [], page: 1, pageCount: 0, total: 0 };

function refuse(error: TournamentInputError, extra: object = {}): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error, ...extra });
}

export const isSlugAvailable = query({
  args: { organizationId: v.id('organizations'), slug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    return (
      isChoosableSlug(args.slug) && !(await leagueSlugTaken(ctx, args.organizationId, args.slug))
    );
  },
});

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
    startDate: v.string(),
    // Absent for a one-day tournament.
    endDate: v.optional(v.string()),
    registrationDeadline: v.string(),
    maximumTeams: v.number(),
  },
  returns: v.object({ tournamentId: v.id('tournaments') }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const locationIds = [...new Set(args.locationIds)];
    const endDate = args.endDate ?? '';
    const refusal = firstTournamentError(
      checkTournamentFields({
        name: args.name,
        slug: args.slug,
        sport: args.sport,
        playersPerSide: args.playersPerSide,
        level: args.level,
        ageGroup: args.ageGroup,
        locationCount: locationIds.length,
        startDate: args.startDate,
        endDate,
        registrationDeadline: args.registrationDeadline,
        maximumTeams: args.maximumTeams,
      }),
    );
    if (refusal) refuse(refusal);
    const customLevel = await ownCustomLevel(
      ctx,
      args.organizationId,
      args.sport,
      args.customLevelId,
    );
    // Distinct ids beyond the organization's locations include one that is not its own.
    const organization = await ctx.db.get('organizations', args.organizationId);
    if (locationIds.length > (organization?.locationCount ?? Infinity)) {
      throw new Error('Not allowed');
    }
    for (const id of locationIds) {
      const location = await ctx.db.get('locations', id);
      if (location?.organizationId !== args.organizationId) throw new Error('Not allowed');
    }
    if (await leagueSlugTaken(ctx, args.organizationId, args.slug)) {
      refuse({
        field: 'slug',
        code: 'slugTaken',
        message: TOURNAMENT_MESSAGES.slugTaken(args.slug),
      });
    }
    const tournamentId = await insertDraftTournament(ctx, args.organizationId, {
      name: args.name.trim(),
      slug: args.slug,
      sport: args.sport,
      locationIds,
      division: {
        gender: args.gender,
        playersPerSide: args.playersPerSide,
        level: customLevel?.standardLevel ?? args.level,
        ...(customLevel && { customLevelId: customLevel._id }),
        ageGroup: ageGroupValidator.members.find((member) => member.value === args.ageGroup)!.value,
      },
      startDate: args.startDate,
      endDate: endDate === '' ? args.startDate : endDate,
      registrationDeadline: args.registrationDeadline,
      maximumTeams: args.maximumTeams,
    });
    return { tournamentId };
  },
});

async function ownCustomLevel(
  ctx: QueryCtx,
  organizationId: Id<'organizations'>,
  sport: Sport,
  customLevelId: Id<'customLevels'> | undefined,
): Promise<Doc<'customLevels'> | null> {
  if (customLevelId === undefined) return null;
  const customLevel = await ctx.db.get('customLevels', customLevelId);
  if (!customLevel) {
    refuse({
      field: 'level',
      code: 'levelInvalid',
      message: TOURNAMENT_MESSAGES.levelInvalid,
    });
  }
  if (customLevel.organizationId !== organizationId || customLevel.sport !== sport) {
    throw new Error('Not allowed');
  }
  return customLevel;
}

export const listForOrganization = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      tournamentId: v.id('tournaments'),
      programId: v.id('programs'),
      name: v.string(),
      slug: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      status: programStatusValidator,
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const tournaments = await ctx.db
      .query('tournaments')
      .withIndex('by_organizationId_and_startDate', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .take(ADMIN_TOURNAMENTS_LIMIT);
    const rows = [];
    for (const tournament of tournaments) {
      const program = await ctx.db.get('programs', tournament.programId);
      if (program?.organizationId !== organizationId) continue;
      rows.push({
        tournamentId: tournament._id,
        programId: program._id,
        name: program.name,
        slug: program.slug,
        startDate: tournament.startDate,
        endDate: tournament.endDate,
        status: program.status,
      });
    }
    return rows;
  },
});

export const publish = mutation({
  args: { tournamentId: v.id('tournaments') },
  returns: v.null(),
  handler: async (ctx, { tournamentId }) => {
    // Signed in first, so an unknown tournament and another organization's look alike.
    await requireUser(ctx);
    const tournament = await ctx.db.get('tournaments', tournamentId);
    if (!tournament) throw new Error('Not allowed');
    await requireProgramOrganizer(ctx, tournament.programId);
    await publishTournament(ctx, tournament);
    return null;
  },
});

const updateReturns = v.object({
  earlier: tournamentEditableValidator,
  written: tournamentEditableValidator,
});

export const updateDetails = mutation({
  args: {
    tournamentId: v.id('tournaments'),
    startDate: v.string(),
    // Absent for a one-day tournament.
    endDate: v.optional(v.string()),
    registrationDeadline: v.string(),
    maximumTeams: v.number(),
    // Absent keeps the sets per game the tournament holds.
    setsPerGame: v.optional(setsPerGameValidator),
    // What the form last showed, so a save made from out-of-date details is refused.
    expected: tournamentEditableValidator,
  },
  returns: updateReturns,
  handler: async (ctx, { tournamentId, expected, ...input }) => {
    const { tournament, program } = await requireTournamentOrganizer(ctx, tournamentId);
    const held = editableOf(tournament);
    if (!sameEditable(held, expected)) {
      refuse(
        {
          field: 'startDate',
          code: 'changedSince',
          message: TOURNAMENT_MESSAGES.changedWhileEditing,
        },
        { current: held },
      );
    }
    const endDate = input.endDate ?? '';
    checkedDetails(tournament, { ...input, endDate });
    if (
      input.setsPerGame !== undefined &&
      !setsPerGameFitsSport(program.sport, input.setsPerGame)
    ) {
      throw new Error('Not allowed');
    }
    return updateTournamentDetails(ctx, tournament, {
      startDate: input.startDate,
      endDate: endDate === '' ? input.startDate : endDate,
      registrationDeadline: input.registrationDeadline,
      maximumTeams: input.maximumTeams,
      setsPerGame: input.setsPerGame ?? held.setsPerGame,
    });
  },
});

export const undoUpdateDetails = mutation({
  args: {
    tournamentId: v.id('tournaments'),
    earlier: tournamentEditableValidator,
    written: tournamentEditableValidator,
  },
  returns: v.null(),
  handler: async (ctx, { tournamentId, earlier, written }) => {
    const { tournament, program } = await requireTournamentOrganizer(ctx, tournamentId);
    if (!sameEditable(editableOf(tournament), written)) {
      refuse({
        field: 'startDate',
        code: 'changedSince',
        message: TOURNAMENT_MESSAGES.changedSince,
      });
    }
    // What `updateDetails` returned fits the sport, so a mismatch is a caller sending its own values.
    if (!setsPerGameFitsSport(program.sport, earlier.setsPerGame)) throw new Error('Not allowed');
    checkedDetails(tournament, earlier);
    await updateTournamentDetails(ctx, tournament, earlier);
    return null;
  },
});

function setsPerGameFitsSport(
  sport: Sport,
  setsPerGame: TournamentEditable['setsPerGame'],
): boolean {
  return setsPerGameIsChosen(sport) || setsPerGame === DEFAULT_SETS_PER_GAME;
}

function checkedDetails(
  tournament: Doc<'tournaments'>,
  values: Omit<TournamentEditable, 'setsPerGame'>,
): void {
  const refusal = firstTournamentError(
    checkTournamentDetails({ ...values, teamCount: tournament.teamCount ?? 0 }),
  );
  if (refusal) refuse(refusal);
}

export const getForManagement = query({
  args: { orgSlug: v.string(), tournamentSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      tournamentId: v.id('tournaments'),
      organizationId: v.id('organizations'),
      role: roleValidator,
      status: programStatusValidator,
      sport: sportValidator,
      teamCount: v.number(),
      setsPerGame: setsPerGameValidator,
      ...tournamentDetailsValidator.fields,
    }),
  ),
  handler: async (ctx, { orgSlug, tournamentSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) {
      // Only staff learn that a web address is unused.
      await requireStaffOrForbidden(ctx, organization._id);
      return null;
    }
    const { membership } = await requireProgramOrganizerOrForbidden(ctx, found.program);
    return {
      tournamentId: found.tournament._id,
      organizationId: organization._id,
      role: membership.role,
      status: found.program.status,
      sport: found.program.sport,
      teamCount: found.tournament.teamCount ?? 0,
      setsPerGame: editableOf(found.tournament).setsPerGame,
      ...(await tournamentDetails(ctx, organization, found)),
    };
  },
});

export const getForCopy = query({
  args: { organizationSlug: v.string(), slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      slug: v.string(),
      sport: sportValidator,
      locationIds: v.array(v.id('locations')),
      gender: genderValidator,
      playersPerSide: v.number(),
      level: standardLevelValidator,
      customLevelId: v.optional(v.id('customLevels')),
      ageGroup: ageGroupValidator,
      maximumTeams: v.number(),
      structure: v.literal('bracket'),
      bracketType: v.literal('single'),
    }),
  ),
  handler: async (ctx, { organizationSlug, slug }) => {
    // Signed in first, so an unknown organization and another organization's look alike.
    await requireUser(ctx);
    const organization = await findOrganizationBySlug(ctx, organizationSlug);
    if (!organization) throw new Error('Not allowed');
    await requireOrgAdmin(ctx, organization._id);
    const found = await findTournamentBySlugs(ctx, organization, slug);
    if (!found) return null;
    const { program, tournament } = found;
    return {
      name: program.name,
      slug: await nextFreeSlug(ctx, organization._id, slugify(program.name)),
      sport: program.sport,
      locationIds: program.locationIds,
      gender: program.gender,
      playersPerSide: program.playersPerSide,
      level: program.level,
      ...(program.customLevelId && { customLevelId: program.customLevelId }),
      ageGroup: program.ageGroup,
      maximumTeams: tournament.maximumTeams,
      structure: tournament.structure,
      bracketType: tournament.bracketType,
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { orgSlug: v.string(), tournamentSlug: v.string() },
  returns: getTournamentPublicPageReturns,
  handler: async (ctx, { orgSlug, tournamentSlug }): Promise<PublicTournamentPage | null> => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return null;
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    // A draft answers like an unknown tournament, so nothing public says whether its slug exists.
    if (found?.program.status !== 'published') return null;
    return {
      ...(await tournamentDetails(ctx, organization, found)),
      isFull: tournamentIsFull(found.tournament),
    };
  },
});

const registrationTeamValidator = v.object({
  teamId: v.id('teams'),
  name: v.string(),
  isCaptain: v.boolean(),
  rosterCount: v.number(),
});

/** The register route's one query. It returns no tournament id: `teams.registerForTournament` finds the tournament from the same slugs. */
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: a published tournament's public fields, plus the caller's own team found from ctx.auth (getCurrentUser); an anonymous caller gets `team: null`.
export const getForRegistration = query({
  args: tournamentSlugsValidator.fields,
  returns: v.union(
    v.null(),
    v.object({
      organizationName: v.string(),
      name: v.string(),
      divisionLabel: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      registrationDeadline: v.string(),
      minimumRosterSize: v.number(),
      maximumTeams: v.number(),
      isFull: v.boolean(),
      team: v.union(v.null(), registrationTeamValidator),
    }),
  ),
  handler: async (ctx, { orgSlug, tournamentSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return null;
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    // A draft answers like an unknown tournament, so nothing says whether its slug exists.
    if (found?.program.status !== 'published') return null;
    const { program, tournament } = found;
    const user = await getCurrentUser(ctx);
    const entry = user ? await adultEntryInTournament(ctx, tournament._id, user._id) : null;
    const team = entry ? await ctx.db.get('teams', entry.teamId) : null;
    return {
      organizationName: organization.name,
      name: program.name,
      divisionLabel: await leagueDivisionLabel(ctx, program),
      startDate: tournament.startDate,
      endDate: tournament.endDate,
      registrationDeadline: tournament.registrationDeadline,
      minimumRosterSize: tournament.minimumRosterSize,
      maximumTeams: tournament.maximumTeams,
      isFull: tournamentIsFull(tournament),
      team:
        team && user
          ? {
              teamId: team._id,
              name: team.name,
              isCaptain: team.captainUserId === user._id,
              rosterCount: team.rosterCount,
            }
          : null,
    };
  },
});

// The date bound is read here, not passed as an argument, because saved copies and server renders key on the route's arguments alone; the page drops a row that has ended since the query last ran.
function today(): string {
  return dateAtUtcMinus12(Date.now());
}

function upcomingByEndDate(
  ctx: QueryCtx,
  organizationId: Id<'organizations'>,
  sport: Sport | undefined,
) {
  const from = today();
  return sport === undefined
    ? ctx.db
        .query('tournaments')
        .withIndex('by_organizationId_and_status_and_endDate', (q) =>
          q.eq('organizationId', organizationId).eq('status', 'published').gte('endDate', from),
        )
    : ctx.db
        .query('tournaments')
        .withIndex('by_organizationId_and_sport_and_status_and_endDate', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('sport', sport)
            .eq('status', 'published')
            .gte('endDate', from),
        );
}

async function ownProgramMatchingDivision(
  ctx: QueryCtx,
  tournament: Doc<'tournaments'>,
  filters: DivisionFilters,
): Promise<Doc<'programs'> | null> {
  const program = await ctx.db.get('programs', tournament.programId);
  if (program?.organizationId !== tournament.organizationId) return null;
  return matchesDivisionFilters(program, filters) ? program : null;
}

async function publicTournamentRow(
  ctx: QueryCtx,
  organization: Doc<'organizations'>,
  tournament: Doc<'tournaments'>,
  program: Doc<'programs'>,
) {
  return {
    name: program.name,
    slug: program.slug,
    sportName: sportName(program.sport),
    divisionLabel: await leagueDivisionLabel(ctx, program),
    locationNames: (await leagueLocations(ctx, organization, program)).map(({ name }) => name),
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline,
    isFull: tournamentIsFull(tournament),
  };
}

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listPublic = query({
  args: {
    organizationSlug: v.string(),
    page: v.number(),
    sport: v.optional(sportValidator),
    ...divisionFilterArgs,
  },
  returns: publicTournamentsValidator,
  handler: async (
    ctx,
    { organizationSlug, page: requested, sport, ...requestedFilters },
  ): Promise<PublicTournaments> => {
    const organization = await findOrganizationBySlug(ctx, organizationSlug);
    if (!organization) return EMPTY_LIST;
    const filters = scopedFilters(organization.sportLeagueCounts, sport, requestedFilters);
    const read = await upcomingByEndDate(ctx, organization._id, sport).take(PUBLIC_LIST_MAX_ROWS);
    const matching: Doc<'tournaments'>[] = [];
    for (const tournament of read) {
      if (
        !hasDivisionFilters(filters) ||
        (await ownProgramMatchingDivision(ctx, tournament, filters))
      ) {
        matching.push(tournament);
      }
    }
    const { page, pageCount } = pageOf(matching.length, requested);
    if (pageCount === 0) return EMPTY_LIST;
    const rows = [];
    for (const tournament of pageRows(matching.slice(0, page * PUBLIC_LIST_PAGE_SIZE), page)) {
      const program = await ownProgramMatchingDivision(ctx, tournament, filters);
      if (program) rows.push(await publicTournamentRow(ctx, organization, tournament, program));
    }
    return { rows, page, pageCount, total: matching.length };
  },
});

// Reads from today's date only to skip closed rows; the page decides at the viewer's time which are open (`registrationIsOpen`).
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listOpenForOrganization = query({
  args: { organizationSlug: v.string(), sport: v.optional(sportValidator), ...divisionFilterArgs },
  returns: publicOpenTournamentsValidator,
  handler: async (
    ctx,
    { organizationSlug, sport, ...requestedFilters },
  ): Promise<PublicOpenTournaments> => {
    const organization = await findOrganizationBySlug(ctx, organizationSlug);
    if (!organization) return [];
    const filters = scopedFilters(organization.sportLeagueCounts, sport, requestedFilters);
    const from = today();
    const read = await ctx.db
      .query('tournaments')
      .withIndex('by_organizationId_and_status_and_registrationDeadline', (q) =>
        q
          .eq('organizationId', organization._id)
          .eq('status', 'published')
          .gte('registrationDeadline', from),
      )
      .take(OPEN_TOURNAMENTS_READ_LIMIT);
    const cards: PublicOpenTournaments = [];
    for (const tournament of read) {
      if (sport !== undefined && tournament.sport !== sport) continue;
      const program = await ownProgramMatchingDivision(ctx, tournament, filters);
      if (!program) continue;
      cards.push({
        ...(await publicTournamentRow(ctx, organization, tournament, program)),
        minimumRosterSize: tournament.minimumRosterSize,
      });
    }
    return cards;
  },
});
