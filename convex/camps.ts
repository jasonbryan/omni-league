import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  requireOrgAdmin,
  requireProgramOrganizerOrForbidden,
  requireStaffOrForbidden,
} from './lib/access';
import {
  CAMP_MESSAGES,
  checkCampFields,
  firstCampError,
  type CampInputError,
} from './lib/campInput';
import { CAMP_SESSIONS_LIMIT, campDetails, findCampBySlugs } from './lib/campLookup';
import { programStatusValidator } from './lib/programs';
import { roleValidator } from './lib/roles';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { isChoosableSlug } from './lib/slugs';
import { sportValidator } from './lib/sports';
import { insertDraftCamp, leagueSlugTaken } from './lib/tenantWrites';

export const ADMIN_CAMPS_LIMIT = 200;

function refuse(error: CampInputError): never {
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
    minimumAge: v.number(),
    maximumAge: v.number(),
  },
  returns: v.object({ campId: v.id('camps') }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const locationIds = [...new Set(args.locationIds)];
    const refusal = firstCampError(
      checkCampFields({
        name: args.name,
        slug: args.slug,
        sport: args.sport,
        locationCount: locationIds.length,
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
      refuse({ field: 'slug', code: 'slugTaken', message: CAMP_MESSAGES.slugTaken(args.slug) });
    }
    const campId = await insertDraftCamp(ctx, args.organizationId, {
      name: args.name.trim(),
      slug: args.slug,
      sport: args.sport,
      locationIds,
      minimumAge: args.minimumAge,
      maximumAge: args.maximumAge,
    });
    return { campId };
  },
});

export const listForOrganization = query({
  args: { organizationId: v.id('organizations') },
  returns: v.array(
    v.object({
      campId: v.id('camps'),
      programId: v.id('programs'),
      name: v.string(),
      slug: v.string(),
      minimumAge: v.number(),
      maximumAge: v.number(),
      status: programStatusValidator,
      sessionCount: v.number(),
    }),
  ),
  handler: async (ctx, { organizationId }) => {
    await requireOrgAdmin(ctx, organizationId);
    const camps = await ctx.db
      .query('camps')
      .withIndex('by_organizationId', (q) => q.eq('organizationId', organizationId))
      .order('desc')
      .take(ADMIN_CAMPS_LIMIT);
    const rows = [];
    for (const camp of camps) {
      const program = await ctx.db.get('programs', camp.programId);
      if (program?.organizationId !== organizationId) continue;
      rows.push({
        campId: camp._id,
        programId: program._id,
        name: program.name,
        slug: program.slug,
        minimumAge: camp.minimumAge,
        maximumAge: camp.maximumAge,
        status: program.status,
        sessionCount: (
          await ctx.db
            .query('campSessions')
            .withIndex('by_campId_and_startDate', (q) => q.eq('campId', camp._id))
            .take(CAMP_SESSIONS_LIMIT)
        ).length,
      });
    }
    return rows;
  },
});

export const getForManagement = query({
  args: { orgSlug: v.string(), campSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      campId: v.id('camps'),
      organizationId: v.id('organizations'),
      organization: v.object({ name: v.string(), slug: v.string() }),
      role: roleValidator,
      name: v.string(),
      slug: v.string(),
      status: programStatusValidator,
      sportName: v.string(),
      minimumAge: v.number(),
      maximumAge: v.number(),
      locations: v.array(v.object({ name: v.string(), address: v.string() })),
    }),
  ),
  handler: async (ctx, { orgSlug, campSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    const found = await findCampBySlugs(ctx, organization, campSlug);
    if (!found) {
      // Only staff learn that a web address is unused.
      await requireStaffOrForbidden(ctx, organization._id);
      return null;
    }
    const { membership } = await requireProgramOrganizerOrForbidden(ctx, found.program);
    return {
      campId: found.camp._id,
      organizationId: organization._id,
      role: membership.role,
      ...(await campDetails(ctx, organization, found)),
    };
  },
});
