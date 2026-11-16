import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { CAMP_SESSIONS_LIMIT } from './campLookup';
import { campSessionPlacesLeft } from './campWaitlist';
import { leagueLocations } from './publicLeague';
import { dateAtUtcMinus12 } from './registration';
import { sportName, type Sport } from './sports';

export const OPEN_CAMPS_READ_LIMIT = 25;

export const OPEN_CAMP_SESSIONS_LIMIT = 30;

// Read here, not passed as an argument, because saved copies and server renders key on the route's arguments alone.
export function today(): string {
  return dateAtUtcMinus12(Date.now());
}

export function upcomingCamps(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
  sport: Sport | undefined,
) {
  const from = today();
  return sport === undefined
    ? ctx.db
        .query('camps')
        .withIndex('by_organizationId_and_status_and_lastSessionEndDate', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('status', 'published')
            .gte('lastSessionEndDate', from),
        )
    : ctx.db
        .query('camps')
        .withIndex('by_organizationId_and_sport_and_status_and_lastSessionEndDate', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('sport', sport)
            .eq('status', 'published')
            .gte('lastSessionEndDate', from),
        );
}

export async function publishedProgramOf(
  ctx: Pick<QueryCtx, 'db'>,
  camp: Doc<'camps'>,
): Promise<Doc<'programs'> | null> {
  const program = await ctx.db.get('programs', camp.programId);
  return program?.organizationId === camp.organizationId && program.status === 'published'
    ? program
    : null;
}

export async function publicCampRow(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  camp: Doc<'camps'>,
  program: Doc<'programs'>,
) {
  return {
    name: program.name,
    slug: program.slug,
    sportName: sportName(program.sport),
    minimumAge: camp.minimumAge,
    maximumAge: camp.maximumAge,
    locationNames: (await leagueLocations(ctx, organization, program)).map(({ name }) => name),
  };
}

export function sessionRow(session: Doc<'campSessions'>) {
  return {
    startDate: session.startDate,
    endDate: session.endDate,
    registrationDeadline: session.registrationDeadline,
    placesLeft: campSessionPlacesLeft(session),
  };
}

export async function sessionsOf(ctx: Pick<QueryCtx, 'db'>, campId: Id<'camps'>) {
  return ctx.db
    .query('campSessions')
    .withIndex('by_campId_and_startDate', (q) => q.eq('campId', campId))
    .take(CAMP_SESSIONS_LIMIT);
}
