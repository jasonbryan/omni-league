import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import {
  requireOrgAdmin,
  requireUser,
  requireProgramOrganizer,
  requireProgramOrganizerOrForbidden,
  requireStaffOrForbidden,
} from './lib/access';
import { isChoosableSlug } from './lib/slugs';
import { ageGroupValidator, genderValidator, standardLevelValidator } from './lib/divisions';
import { programStatusValidator } from './lib/programs';
import { roleValidator } from './lib/roles';
import { getTournamentPublicPageReturns, type PublicTournamentPage } from './lib/publicPage';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { tournamentDetailsValidator } from './lib/tournamentDetails';
import { findTournamentBySlugs, tournamentDetails } from './lib/tournamentLookup';
import { sportValidator, type Sport } from './lib/sports';
import {
  checkTournamentFields,
  firstTournamentError,
  TOURNAMENT_MESSAGES,
  type TournamentInputError,
} from './lib/tournamentInput';
import { insertDraftTournament, leagueSlugTaken, publishTournament } from './lib/tenantWrites';

export const ADMIN_TOURNAMENTS_LIMIT = 200;

function refuse(error: TournamentInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
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

export const getForManagement = query({
  args: { orgSlug: v.string(), tournamentSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      tournamentId: v.id('tournaments'),
      organizationId: v.id('organizations'),
      role: roleValidator,
      status: programStatusValidator,
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
      ...(await tournamentDetails(ctx, organization, found)),
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
    return tournamentDetails(ctx, organization, found);
  },
});
