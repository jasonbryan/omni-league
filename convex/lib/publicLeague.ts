import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

// Leaves out a location of another organization, so a stray id never shows it.
export async function leagueLocationNames(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  league: Doc<'leagues'>,
): Promise<string[]> {
  const names: string[] = [];
  for (const id of league.locationIds) {
    const location = await ctx.db.get('locations', id);
    if (location?.organizationId === organization._id) names.push(location.name);
  }
  return names;
}

export const LEAGUE_ROW_SEASONS = 3;

/** The dates a league row needs to name its next season. */
export async function leagueRowSeasons(ctx: Pick<QueryCtx, 'db'>, league: Doc<'leagues'>) {
  const seasons = await ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_status_and_startDate', (q) =>
      q.eq('leagueId', league._id).eq('status', 'published'),
    )
    .order('desc')
    .take(LEAGUE_ROW_SEASONS);
  return seasons.map((season) => ({
    name: season.name,
    slug: season.slug,
    startDate: season.startDate,
    endDate: season.endDate,
    registrationDeadline: season.registrationDeadline,
  }));
}
