import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  requireCampOrganizer,
  requireOrgAdmin,
  requireProgramOrganizerOrForbidden,
  requireStaffOrForbidden,
} from './lib/access';
import {
  CAMP_MESSAGES,
  CAMP_PUBLISH_MESSAGES,
  checkCampFields,
  firstCampError,
  type CampInputError,
} from './lib/campInput';
import {
  campDetails,
  campSessionTotal,
  findCampBySlugs,
  publicCampSessions,
  recountCampSessions,
} from './lib/campLookup';
import {
  OPEN_CAMPS_READ_LIMIT,
  OPEN_CAMP_SESSIONS_LIMIT,
  publicCampRow,
  publishedProgramOf,
  sessionRow,
  sessionsOf,
  today,
  upcomingCamps,
} from './lib/campPublicList';
import { pageOf, pageRows, PUBLIC_LIST_MAX_ROWS, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import {
  getCampPublicPageReturns,
  publicCampsValidator,
  publicOpenCampSessionsValidator,
  type PublicCamps,
  type PublicCampPage,
  type PublicOpenCampSessions,
} from './lib/publicPage';
import { programStatusValidator } from './lib/programs';
import { roleValidator } from './lib/roles';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { isChoosableSlug } from './lib/slugs';
import { sportValidator } from './lib/sports';
import { insertDraftCamp, leagueSlugTaken, publishCamp } from './lib/tenantWrites';

export const ADMIN_CAMPS_LIMIT = 200;

const EMPTY_LIST = { rows: [], page: 1, pageCount: 0, total: 0 };

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
        sessionCount: camp.sessionCount ?? (await recountCampSessions(ctx, camp._id)),
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

export const publish = mutation({
  args: { campId: v.id('camps') },
  returns: v.null(),
  handler: async (ctx, { campId }) => {
    const { camp, program } = await requireCampOrganizer(ctx, campId);
    if (program.status === 'published') return null;
    if ((await campSessionTotal(ctx, camp)) === 0) {
      throw new ConvexError({
        code: 'noSessions',
        message: CAMP_PUBLISH_MESSAGES.noSessions,
      });
    }
    await publishCamp(ctx, camp);
    return null;
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const getPublicPage = query({
  args: { orgSlug: v.string(), campSlug: v.string() },
  returns: getCampPublicPageReturns,
  handler: async (ctx, { orgSlug, campSlug }): Promise<PublicCampPage | null> => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return null;
    const found = await findCampBySlugs(ctx, organization, campSlug);
    // A draft answers like an unknown camp, so nothing public says whether its slug exists.
    if (found?.program.status !== 'published') return null;
    const details = await campDetails(ctx, organization, found);
    return {
      organization: details.organization,
      name: details.name,
      slug: details.slug,
      sportName: details.sportName,
      minimumAge: details.minimumAge,
      maximumAge: details.maximumAge,
      locations: details.locations,
      sessions: await publicCampSessions(ctx, found.camp),
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listPublic = query({
  args: { organizationSlug: v.string(), page: v.number(), sport: v.optional(sportValidator) },
  returns: publicCampsValidator,
  handler: async (ctx, { organizationSlug, page: requested, sport }): Promise<PublicCamps> => {
    const organization = await findOrganizationBySlug(ctx, organizationSlug);
    if (!organization) return EMPTY_LIST;
    const read = await upcomingCamps(ctx, organization._id, sport).take(PUBLIC_LIST_MAX_ROWS);
    const { page, pageCount } = pageOf(read.length, requested);
    if (pageCount === 0) return EMPTY_LIST;
    const from = today();
    const rows = [];
    for (const camp of pageRows(read.slice(0, page * PUBLIC_LIST_PAGE_SIZE), page)) {
      const program = await publishedProgramOf(ctx, camp);
      const sessions = (await sessionsOf(ctx, camp._id))
        .filter((session) => session.endDate >= from)
        .map((session) => ({ name: session.name, ...sessionRow(session) }));
      if (program && sessions.length > 0 && camp.lastSessionEndDate !== undefined) {
        rows.push({
          ...(await publicCampRow(ctx, organization, camp, program)),
          lastSessionEndDate: camp.lastSessionEndDate,
          sessions,
        });
      }
    }
    return { rows, page, pageCount, total: read.length };
  },
});

// Reads from today's date only to skip sessions that have started or closed; the page decides at the viewer's time which are open (`registrationIsOpen`).
// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous public page that reads no identity and returns only published fields.
export const listOpenForOrganization = query({
  args: { organizationSlug: v.string(), sport: v.optional(sportValidator) },
  returns: publicOpenCampSessionsValidator,
  handler: async (ctx, { organizationSlug, sport }): Promise<PublicOpenCampSessions> => {
    const organization = await findOrganizationBySlug(ctx, organizationSlug);
    if (!organization) return [];
    const from = today();
    const read = await upcomingCamps(ctx, organization._id, sport).take(OPEN_CAMPS_READ_LIMIT);
    const cards: PublicOpenCampSessions = [];
    for (const camp of read) {
      const program = await publishedProgramOf(ctx, camp);
      if (!program) continue;
      const row = await publicCampRow(ctx, organization, camp, program);
      for (const session of await sessionsOf(ctx, camp._id)) {
        const { placesLeft, ...dates } = sessionRow(session);
        if (session.startDate <= from || session.registrationDeadline < from || placesLeft === 0) {
          continue;
        }
        cards.push({ ...row, sessionName: session.name, ...dates, placesLeft });
      }
    }
    // Cut after sorting, so the sessions that close soonest are the ones kept.
    return cards
      .sort(
        (a, b) =>
          a.registrationDeadline.localeCompare(b.registrationDeadline) ||
          a.name.localeCompare(b.name) ||
          a.sessionName.localeCompare(b.sessionName),
      )
      .slice(0, OPEN_CAMP_SESSIONS_LIMIT);
  },
});
