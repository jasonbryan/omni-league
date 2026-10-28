import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query } from './_generated/server';
import { leagueDivisionLabel } from './lib/leagueDivision';
import { leagueLocationNames, leagueRowSeasons } from './lib/publicLeague';
import { searchLeaguesValidator, type SearchLeagues } from './lib/publicPage';
import { parseSearchQuery } from './lib/searchQuery';
import { sportName } from './lib/sports';

export const SEARCH_RESULT_LIMIT = 50;

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous search that reads no identity and returns only published fields, with no ids.
export const leagues = query({
  args: { q: v.string() },
  returns: searchLeaguesValidator,
  handler: async (ctx, args): Promise<SearchLeagues> => {
    // The browser sends it already parsed; a caller that does not is held to the same limits.
    const q = parseSearchQuery([args.q]);
    if (q === '') return { rows: [], more: false };
    const found = await ctx.db
      .query('leagues')
      .withSearchIndex('search_searchText', (search) =>
        search.search('searchText', q).eq('status', 'published'),
      )
      .take(SEARCH_RESULT_LIMIT + 1);

    const organizations = new Map<Id<'organizations'>, Doc<'organizations'> | null>();
    const rows: SearchLeagues['rows'] = [];
    for (const league of found.slice(0, SEARCH_RESULT_LIMIT)) {
      if (!organizations.has(league.organizationId)) {
        organizations.set(
          league.organizationId,
          await ctx.db.get('organizations', league.organizationId),
        );
      }
      const organization = organizations.get(league.organizationId);
      if (!organization) continue;
      const label = await leagueDivisionLabel(ctx, league);
      rows.push({
        organization: { name: organization.name, slug: organization.slug },
        name: league.name,
        slug: league.slug,
        sportName: sportName(league.sport),
        locationNames: await leagueLocationNames(ctx, organization, league),
        ...(label !== undefined && { divisionLabel: label }),
        seasons: await leagueRowSeasons(ctx, league),
      });
    }
    return { rows, more: found.length > SEARCH_RESULT_LIMIT };
  },
});
