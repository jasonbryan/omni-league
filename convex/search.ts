import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { leagueDivisionLabel } from './lib/leagueDivision';
import { divisionFilterArgs, filtersInScope, matchesDivisionFilters } from './lib/leagueFilters';
import { logoUrlField } from './lib/organizationLogo';
import { leagueLocationNames, leagueRowSeasons } from './lib/publicLeague';
import { pageOf, pageRows, PUBLIC_LIST_MAX_ROWS, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import {
  searchLeaguesBySportValidator,
  searchLeaguesValidator,
  searchOrganizationsValidator,
  type PublicLeagueFacets,
  type SearchLeagues,
  type SearchLeaguesBySport,
  type SearchOrganizations,
} from './lib/publicPage';
import {
  matchesEveryWord,
  parseSearchQuery,
  stripPossessives,
  suggestFewerWords,
} from './lib/searchQuery';
import { SPORT_NAMES, sportName, sportValidator, type Sport } from './lib/sports';

export const SEARCH_RESULT_LIMIT = 50;

export const SEARCH_SCAN_LIMIT = 200;

/** Every league gets one, even with no division values, so the facets count the leagues. */
function facetOf(league: Doc<'leagues'>): PublicLeagueFacets[number] {
  const { gender, playersPerSide, level, ageGroup } = league;
  return {
    ...(gender !== undefined && { gender }),
    ...(playersPerSide !== undefined && { playersPerSide }),
    ...(level !== undefined && { level }),
    ...(ageGroup !== undefined && { ageGroup }),
  };
}

async function searchRows(
  ctx: QueryCtx,
  leagues: readonly Doc<'leagues'>[],
): Promise<SearchLeagues['rows']> {
  const organizations = new Map<Id<'organizations'>, Doc<'organizations'> | null>();
  const rows: SearchLeagues['rows'] = [];
  for (const league of leagues) {
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
      organization: {
        name: organization.name,
        slug: organization.slug,
        ...(await logoUrlField(ctx, organization)),
      },
      name: league.name,
      slug: league.slug,
      sportName: sportName(league.sport),
      locationNames: await leagueLocationNames(ctx, organization, league),
      ...(label !== undefined && { divisionLabel: label }),
      seasons: await leagueRowSeasons(ctx, league),
    });
  }
  return rows;
}

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous search that reads no identity and returns only published fields, with no ids.
export const leagues = query({
  args: { q: v.string(), sport: v.optional(sportValidator), ...divisionFilterArgs },
  returns: searchLeaguesValidator,
  handler: async (ctx, args): Promise<SearchLeagues> => {
    // The browser sends it already parsed; a caller that does not is held to the same limits.
    const q = stripPossessives(parseSearchQuery([args.q]));
    if (q === '') return { rows: [], more: false };
    const { sport } = args;
    const scanned = await ctx.db
      .query('leagues')
      .withSearchIndex('search_searchText', (search) => {
        const published = search.search('searchText', q).eq('status', 'published');
        return sport === undefined ? published : published.eq('sport', sport);
      })
      .take(SEARCH_SCAN_LIMIT);
    const filters = filtersInScope(args, sport);
    const passes = (league: Doc<'leagues'>) => matchesDivisionFilters(league, filters);
    const kept = scanned.filter((league) => matchesEveryWord(league.searchText ?? '', q));
    const matched = kept.filter(passes);
    const facets = kept.map(facetOf);
    const rows = await searchRows(ctx, matched.slice(0, SEARCH_RESULT_LIMIT));
    const more = matched.length > SEARCH_RESULT_LIMIT;
    // Leagues that hold every word but fail the division filters mean fewer words would not help.
    if (kept.length > 0) return { rows, more, facets };
    const suggestions = suggestFewerWords(
      scanned.filter(passes).map((league) => league.searchText ?? ''),
      q,
    );
    return suggestions.length === 0 ? { rows, more, facets } : { rows, more, facets, suggestions };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous list that reads no identity and returns only published fields, with no ids.
export const leaguesBySport = query({
  args: { sport: sportValidator, ...divisionFilterArgs, page: v.number() },
  returns: searchLeaguesBySportValidator,
  handler: async (ctx, args): Promise<SearchLeaguesBySport> => {
    const read = await ctx.db
      .query('leagues')
      .withIndex('by_status_and_sport_and_sortName', (q) =>
        q.eq('status', 'published').eq('sport', args.sport),
      )
      .take(PUBLIC_LIST_MAX_ROWS);
    const filters = filtersInScope(args, args.sport);
    const matched = read.filter((league) => matchesDivisionFilters(league, filters));
    const { page, pageCount } = pageOf(matched.length, args.page);
    const rows = await searchRows(ctx, pageRows(matched, page).slice(0, PUBLIC_LIST_PAGE_SIZE));
    return { rows, page, pageCount, total: matched.length, facets: read.map(facetOf) };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous list that reads no identity and returns only published fields, with no ids.
export const organizations = query({
  args: { page: v.number() },
  returns: searchOrganizationsValidator,
  handler: async (ctx, args): Promise<SearchOrganizations> => {
    // The index holds no counter, so the list is read whole, up to the most rows a public list reaches.
    const listed = await ctx.db
      .query('organizations')
      .withIndex('by_hasPublishedLeague_and_sortName', (q) => q.eq('hasPublishedLeague', true))
      .take(PUBLIC_LIST_MAX_ROWS);
    const { page, pageCount } = pageOf(listed.length, args.page);
    const start = (page - 1) * PUBLIC_LIST_PAGE_SIZE;
    const rows = [];
    for (const organization of listed.slice(start, start + PUBLIC_LIST_PAGE_SIZE)) {
      rows.push({
        name: organization.name,
        slug: organization.slug,
        sportNames: (Object.keys(SPORT_NAMES) as Sport[])
          .filter((sport) => (organization.sportLeagueCounts?.[sport] ?? 0) > 0)
          .map(sportName),
        ...(organization.cityState !== undefined && { cityState: organization.cityState }),
        ...(await logoUrlField(ctx, organization)),
      });
    }
    return { rows, page, pageCount, total: listed.length };
  },
});
