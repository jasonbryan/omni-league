import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  requireOrgAdmin,
  requireProgramOrganizerOrForbidden,
  requireStaffOrForbidden,
} from './lib/access';
import { roleValidator } from './lib/roles';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { findTrainingBySlugs, trainingDetails } from './lib/trainingLookup';
import { trainingPatternValidator } from './lib/trainingPattern';
import { programStatusValidator } from './lib/programs';
import { isChoosableSlug } from './lib/slugs';
import { sportValidator } from './lib/sports';
import { insertDraftTraining, leagueSlugTaken } from './lib/tenantWrites';
import {
  checkTrainingFields,
  firstTrainingError,
  TRAINING_MESSAGES,
  type TrainingInputError,
} from './lib/trainingInput';

export const ADMIN_TRAININGS_LIMIT = 200;

function refuse(error: TrainingInputError): never {
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
    coachName: v.string(),
    minimumAge: v.optional(v.number()),
    maximumAge: v.optional(v.number()),
  },
  returns: v.object({ trainingId: v.id('trainings') }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const locationIds = [...new Set(args.locationIds)];
    const refusal = firstTrainingError(
      checkTrainingFields({
        name: args.name,
        slug: args.slug,
        sport: args.sport,
        locationCount: locationIds.length,
        coachName: args.coachName,
        minimumAge: args.minimumAge,
        maximumAge: args.maximumAge,
      }),
    );
    if (refusal) refuse(refusal);
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
        message: TRAINING_MESSAGES.slugTaken(args.slug),
      });
    }
    const trainingId = await insertDraftTraining(ctx, args.organizationId, {
      name: args.name.trim(),
      slug: args.slug,
      sport: args.sport,
      locationIds,
      coachName: args.coachName.trim(),
      ...(args.minimumAge !== undefined && { minimumAge: args.minimumAge }),
      ...(args.maximumAge !== undefined && { maximumAge: args.maximumAge }),
    });
    return { trainingId };
  },
});

export const listForOrganization = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      trainingId: v.id('trainings'),
      programId: v.id('programs'),
      name: v.string(),
      slug: v.string(),
      coachName: v.string(),
      minimumAge: v.optional(v.number()),
      maximumAge: v.optional(v.number()),
      status: programStatusValidator,
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const trainings = await ctx.db
      .query('trainings')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .take(ADMIN_TRAININGS_LIMIT);
    const rows = [];
    for (const training of trainings) {
      const program = await ctx.db.get('programs', training.programId);
      if (program?.organizationId !== organizationId) continue;
      rows.push({
        trainingId: training._id,
        programId: program._id,
        name: program.name,
        slug: program.slug,
        coachName: training.coachName,
        ...(training.minimumAge !== undefined && { minimumAge: training.minimumAge }),
        ...(training.maximumAge !== undefined && { maximumAge: training.maximumAge }),
        status: program.status,
      });
    }
    return rows;
  },
});

export const getForManagement = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      trainingId: v.id('trainings'),
      organizationId: v.id('organizations'),
      organization: v.object({ name: v.string(), slug: v.string() }),
      role: roleValidator,
      name: v.string(),
      slug: v.string(),
      status: programStatusValidator,
      sportName: v.string(),
      coachName: v.string(),
      minimumAge: v.optional(v.number()),
      maximumAge: v.optional(v.number()),
      pattern: v.optional(trainingPatternValidator),
      locations: v.array(v.object({ name: v.string(), address: v.string() })),
    }),
  ),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
    if (!found) {
      // Only staff learn that a web address is unused.
      await requireStaffOrForbidden(ctx, organization._id);
      return null;
    }
    const { membership } = await requireProgramOrganizerOrForbidden(ctx, found.program);
    return {
      trainingId: found.training._id,
      organizationId: organization._id,
      role: membership.role,
      ...(await trainingDetails(ctx, organization, found)),
    };
  },
});
