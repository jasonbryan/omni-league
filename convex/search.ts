import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import {
  divisionFilterArgs,
  filtersInScope,
  matchesDivisionFilters,
  type DivisionFilters,
} from './lib/leagueFilters';
import { logoUrlField } from './lib/organizationLogo';
import { pageOf, pageRows, PUBLIC_LIST_MAX_ROWS, PUBLIC_LIST_PAGE_SIZE } from './lib/publicList';
import {
  DIVISIONLESS_PROGRAM_TYPES,
  programTypeValidator,
  searchableProgramTypes,
  type ProgramType,
} from './lib/programs';
import {
  searchLeaguesBySportValidator,
  searchLeaguesValidator,
  searchOrganizationsValidator,
  searchProgramsBrowseValidator,
  searchProgramsValidator,
  type SearchLeagues,
  type SearchLeaguesBySport,
  type SearchOrganizations,
  type SearchPrograms,
  type SearchProgramsBrowse,
} from './lib/publicPage';
import {
  campIsUpcoming,
  searchProgramRows,
  searchRows,
  tournamentIsUpcoming,
  trainingIsUpcoming,
} from './lib/searchRows';
import {
  matchesEveryWord,
  parseSearchQuery,
  stripPossessives,
  suggestFewerWords,
} from './lib/searchQuery';
import { SPORT_NAMES, sportName, sportValidator, type Sport } from './lib/sports';

export const SEARCH_RESULT_LIMIT = 50;

export const SEARCH_SCAN_LIMIT = 200;

function facetOf({ gender, playersPerSide, level, ageGroup }: Doc<'leagues'> | Doc<'programs'>) {
  return { gender, playersPerSide, level, ageGroup };
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
    const kept = scanned.filter((league) => matchesEveryWord(league.searchText, q));
    const matched = kept.filter(passes);
    const facets = kept.map(facetOf);
    const rows = await searchRows(ctx, matched.slice(0, SEARCH_RESULT_LIMIT));
    const more = matched.length > SEARCH_RESULT_LIMIT;
    // Leagues that hold every word but fail the division filters mean fewer words would not help.
    if (kept.length > 0) return { rows, more, facets };
    const suggestions = suggestFewerWords(
      scanned.filter(passes).map((league) => league.searchText),
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

function typeCountsOf(
  programs: readonly Doc<'programs'>[],
  types: readonly ProgramType[],
): SearchPrograms['typeCounts'] {
  return types
    .map((type) => ({ type, count: programs.filter((program) => program.type === type).length }))
    .filter(({ count }) => count > 0);
}

const isDivisionless = (program: Doc<'programs'>) =>
  DIVISIONLESS_PROGRAM_TYPES.includes(program.type);

function narrowedByDivision(program: Doc<'programs'>, filters: DivisionFilters): boolean {
  return isDivisionless(program) || matchesDivisionFilters(program, filters);
}

async function isUpcoming(ctx: QueryCtx, program: Doc<'programs'>): Promise<boolean> {
  if (program.type === 'camp') return campIsUpcoming(ctx, program);
  if (program.type === 'training') return trainingIsUpcoming(ctx, program);
  if (program.type === 'tournament') return tournamentIsUpcoming(ctx, program);
  return true;
}

async function withoutEnded(
  ctx: QueryCtx,
  programs: readonly Doc<'programs'>[],
): Promise<Doc<'programs'>[]> {
  const kept: Doc<'programs'>[] = [];
  for (const program of programs) {
    if (await isUpcoming(ctx, program)) kept.push(program);
  }
  return kept;
}

const divisionFacets = (programs: readonly Doc<'programs'>[]) =>
  programs.filter((program) => !isDivisionless(program)).map(facetOf);

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous search that reads no identity and returns only published fields, with no ids.
export const programs = query({
  args: {
    q: v.string(),
    type: v.optional(programTypeValidator),
    sport: v.optional(sportValidator),
    // Without them the call is an earlier release's, whose page renders a camp or a training program as a tournament.
    withCamps: v.optional(v.boolean()),
    withTraining: v.optional(v.boolean()),
    ...divisionFilterArgs,
  },
  returns: searchProgramsValidator,
  handler: async (ctx, args): Promise<SearchPrograms> => {
    // The browser sends it already parsed; a caller that does not is held to the same limits.
    const q = stripPossessives(parseSearchQuery([args.q]));
    if (q === '') return { rows: [], more: false, typeCounts: [] };
    const { sport, type } = args;
    const types = searchableProgramTypes(args.withCamps, args.withTraining);
    const scanned = await withoutEnded(
      ctx,
      (
        await ctx.db
          .query('programs')
          .withSearchIndex('search_searchText', (search) => {
            const published = search.search('searchText', q).eq('status', 'published');
            return sport === undefined ? published : published.eq('sport', sport);
          })
          .take(SEARCH_SCAN_LIMIT)
      ).filter((program) => types.includes(program.type)),
    );
    const filters = filtersInScope(args, sport);
    const passesDivision = (program: Doc<'programs'>) => narrowedByDivision(program, filters);
    const passesType = (program: Doc<'programs'>) => type === undefined || program.type === type;
    const kept = scanned.filter((program) => matchesEveryWord(program.searchText ?? '', q));
    const ofType = kept.filter(passesType);
    const matched = ofType.filter(passesDivision);
    const typeCounts = typeCountsOf(kept.filter(passesDivision), types);
    const facets = divisionFacets(ofType);
    const rows = await searchProgramRows(ctx, matched.slice(0, SEARCH_RESULT_LIMIT));
    const more = matched.length > SEARCH_RESULT_LIMIT;
    // Programs that hold every word but fail the type or the division filters mean fewer words would not help.
    if (kept.length > 0) return { rows, more, facets, typeCounts };
    const suggestions = suggestFewerWords(
      scanned
        .filter(passesType)
        .filter(passesDivision)
        .map((program) => program.searchText ?? ''),
      q,
    );
    return suggestions.length === 0
      ? { rows, more, facets, typeCounts }
      : { rows, more, facets, typeCounts, suggestions };
  },
});

function bySortName(a: Doc<'programs'>, b: Doc<'programs'>): number {
  if (a.sortName !== b.sortName) return a.sortName < b.sortName ? -1 : 1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

// The index orders by sport before name, so with no sport the first 200 by name are the first 200 of each sport's own run, merged.
async function firstByName(
  ctx: QueryCtx,
  type: ProgramType,
  sport: Sport | undefined,
): Promise<Doc<'programs'>[]> {
  const sports = sport === undefined ? (Object.keys(SPORT_NAMES) as Sport[]) : [sport];
  const read: Doc<'programs'>[] = [];
  for (const own of sports) {
    read.push(
      ...(await ctx.db
        .query('programs')
        .withIndex('by_status_and_type_and_sport_and_sortName', (q) =>
          q.eq('status', 'published').eq('type', type).eq('sport', own),
        )
        .take(PUBLIC_LIST_MAX_ROWS)),
    );
  }
  return read.sort(bySortName).slice(0, PUBLIC_LIST_MAX_ROWS);
}

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: an anonymous list that reads no identity and returns only published fields, with no ids.
export const programsBrowse = query({
  args: {
    type: v.optional(programTypeValidator),
    sport: v.optional(sportValidator),
    // As on `programs`.
    withCamps: v.optional(v.boolean()),
    withTraining: v.optional(v.boolean()),
    ...divisionFilterArgs,
    page: v.number(),
  },
  returns: searchProgramsBrowseValidator,
  handler: async (ctx, args): Promise<SearchProgramsBrowse> => {
    const { sport, type } = args;
    const types = searchableProgramTypes(args.withCamps, args.withTraining);
    // Every listed type is read, so the type chips count them all; the chosen type is applied after.
    const read: Doc<'programs'>[] = [];
    for (const listed of types) {
      read.push(...(await withoutEnded(ctx, await firstByName(ctx, listed, sport))));
    }
    read.sort(bySortName);
    const filters = filtersInScope(args, sport);
    const passesDivision = (program: Doc<'programs'>) => narrowedByDivision(program, filters);
    const ofType = read.filter((program) => type === undefined || program.type === type);
    const matched = ofType.filter(passesDivision).slice(0, PUBLIC_LIST_MAX_ROWS);
    const { page, pageCount } = pageOf(matched.length, args.page);
    const rows = await searchProgramRows(
      ctx,
      pageRows(matched, page).slice(0, PUBLIC_LIST_PAGE_SIZE),
    );
    return {
      rows,
      page,
      pageCount,
      total: matched.length,
      facets: divisionFacets(ofType),
      typeCounts: typeCountsOf(read.filter(passesDivision), types),
    };
  },
});
