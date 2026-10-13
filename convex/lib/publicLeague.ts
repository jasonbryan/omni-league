// The league fields a public page shows, read the same way by every public query that shows them
// (`leagues.getPublicPage`, #127; `seasons.getPublicPage`, #128).
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * The names of the league's locations, in the league's own order. An id that is missing, or that
 * names a location of another organization, is left out, so a stray id never shows another
 * organization's location.
 */
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
