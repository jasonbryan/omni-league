import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { MAX_CAMP_SESSIONS } from './campSessionInput';
import { leagueLocations } from './publicLeague';
import { sportName } from './sports';

export const CAMP_SESSIONS_LIMIT = MAX_CAMP_SESSIONS;

export async function recountCampSessions(
  ctx: Pick<QueryCtx, 'db'>,
  campId: Id<'camps'>,
): Promise<number> {
  const sessions = await ctx.db
    .query('campSessions')
    .withIndex('by_campId_and_startDate', (q) => q.eq('campId', campId))
    .take(CAMP_SESSIONS_LIMIT);
  return sessions.length;
}

export async function campSessionTotal(
  ctx: Pick<QueryCtx, 'db'>,
  camp: Doc<'camps'>,
): Promise<number> {
  return camp.sessionCount ?? (await recountCampSessions(ctx, camp._id));
}

export async function findCampBySlugs(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  campSlug: string,
) {
  const program = await ctx.db
    .query('programs')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', campSlug),
    )
    .unique();
  if (program?.type !== 'camp') return null;
  const camp = await ctx.db
    .query('camps')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
  return camp?.organizationId === organization._id ? { program, camp } : null;
}

export async function campDetails(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  { program, camp }: { program: Doc<'programs'>; camp: Doc<'camps'> },
) {
  return {
    organization: { name: organization.name, slug: organization.slug },
    name: program.name,
    slug: program.slug,
    status: program.status,
    sportName: sportName(program.sport),
    minimumAge: camp.minimumAge,
    maximumAge: camp.maximumAge,
    locations: await leagueLocations(ctx, organization, program),
  };
}

export async function publicCampSessions(ctx: Pick<QueryCtx, 'db'>, camp: Doc<'camps'>) {
  const sessions = await ctx.db
    .query('campSessions')
    .withIndex('by_campId_and_startDate', (q) => q.eq('campId', camp._id))
    .take(CAMP_SESSIONS_LIMIT);
  return sessions.map((session) => ({
    sessionId: session._id,
    name: session.name,
    startDate: session.startDate,
    endDate: session.endDate,
    ...(session.dailyStartTime !== undefined && { dailyStartTime: session.dailyStartTime }),
    ...(session.dailyEndTime !== undefined && { dailyEndTime: session.dailyEndTime }),
    placesLeft: Math.max(0, session.places - session.registeredCount),
    registrationDeadline: session.registrationDeadline,
  }));
}

/** A session of a draft camp answers like an unknown one, so nothing says whether it exists. */
export async function publishedCampOfSession(
  ctx: Pick<QueryCtx, 'db'>,
  sessionId: Id<'campSessions'>,
): Promise<{ session: Doc<'campSessions'>; camp: Doc<'camps'> } | null> {
  const session = await ctx.db.get('campSessions', sessionId);
  if (!session) return null;
  const camp = await ctx.db.get('camps', session.campId);
  if (camp?.organizationId !== session.organizationId) return null;
  const program = await ctx.db.get('programs', camp.programId);
  if (program?.status !== 'published' || program.organizationId !== camp.organizationId) {
    return null;
  }
  return { session, camp };
}
