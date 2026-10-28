import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

// Leaves out a location of another organization, so a stray id never shows it.
export async function leagueLocations(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  league: Doc<'leagues'>,
): Promise<{ name: string; address: string }[]> {
  const locations: { name: string; address: string }[] = [];
  for (const id of league.locationIds) {
    const location = await ctx.db.get('locations', id);
    if (location?.organizationId === organization._id) {
      locations.push({ name: location.name, address: location.address });
    }
  }
  return locations;
}

export async function leagueLocationNames(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  league: Doc<'leagues'>,
): Promise<string[]> {
  const locations = await leagueLocations(ctx, organization, league);
  return locations.map((location) => location.name);
}

export const LEAGUE_ROW_SEASONS = 3;

async function newestPublishedSeasons(ctx: Pick<QueryCtx, 'db'>, league: Doc<'leagues'>) {
  return ctx.db
    .query('seasons')
    .withIndex('by_leagueId_and_status_and_startDate', (q) =>
      q.eq('leagueId', league._id).eq('status', 'published'),
    )
    .order('desc')
    .take(LEAGUE_ROW_SEASONS);
}

export async function leagueRowSeasons(ctx: Pick<QueryCtx, 'db'>, league: Doc<'leagues'>) {
  const seasons = await newestPublishedSeasons(ctx, league);
  return seasons.map((season) => ({
    name: season.name,
    slug: season.slug,
    startDate: season.startDate,
    endDate: season.endDate,
    registrationDeadline: season.registrationDeadline,
  }));
}

export async function leaguePageSeasons(ctx: Pick<QueryCtx, 'db'>, league: Doc<'leagues'>) {
  const seasons = await newestPublishedSeasons(ctx, league);
  return seasons.map((season) => ({
    name: season.name,
    slug: season.slug,
    startDate: season.startDate,
    endDate: season.endDate,
    registrationDeadline: season.registrationDeadline,
    minimumRosterSize: season.minimumRosterSize,
  }));
}
