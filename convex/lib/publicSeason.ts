import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export const UPCOMING_SEASONS_LIMIT = 3;

// A league has few seasons; the bound stops a runaway league from reading its whole history.
const UPCOMING_SEASONS_READ_LIMIT = 50;

/** Reads no clock: the page decides which of these is open at the viewer's time. */
export async function leagueUpcomingSeasons(ctx: Pick<QueryCtx, 'db'>, league: Doc<'leagues'>) {
  const seasons = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_status_and_startDate', (q) =>
      q.eq('leagueId', league._id).eq('status', 'published'),
    )
    .order('desc')
    .take(UPCOMING_SEASONS_READ_LIMIT);
  return seasons
    .sort((a, b) => b.registrationDeadline.localeCompare(a.registrationDeadline))
    .slice(0, UPCOMING_SEASONS_LIMIT)
    .map((season) => ({
      name: season.name,
      slug: season.slug,
      startDate: season.startDate,
      registrationDeadline: season.registrationDeadline,
    }));
}
