import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireOrgAdmin } from './lib/access';
import { ageGroupValidator, genderValidator, standardLevelValidator } from './lib/divisions';
import { programStatusValidator } from './lib/programs';
import { sportValidator, type Sport } from './lib/sports';
import {
  checkTournamentFields,
  firstTournamentError,
  TOURNAMENT_MESSAGES,
  type TournamentInputError,
} from './lib/tournamentInput';
import { insertDraftTournament, leagueSlugTaken } from './lib/tenantWrites';

export const ADMIN_TOURNAMENTS_LIMIT = 200;

function refuse(error: TournamentInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
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
        endDate: args.endDate ?? '',
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
      endDate: args.endDate ?? args.startDate,
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
