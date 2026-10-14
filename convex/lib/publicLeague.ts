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
