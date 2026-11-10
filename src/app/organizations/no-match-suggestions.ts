import type { Params } from '@angular/router';
import type { DivisionFilters } from '../../../convex/lib/leagueFilters';
import type { Sport, SportCounts } from '../../../convex/lib/sports';
import { draftLeagueCount } from './filter-draft';
import { filterPills, type FilterPill, type LeagueFacet } from './division-filters';

export interface RemovalSuggestion {
  readonly label: string;
  readonly count: number;
  readonly text: string;
  readonly query: Params;
}

function leagues(count: number): string {
  return `${count} ${count === 1 ? 'league' : 'leagues'}`;
}

function wordsByDimension(pills: readonly FilterPill[]): string {
  const dimensions = [...new Set(pills.map((pill) => pill.dimension))];
  return dimensions
    .map((dimension) =>
      pills
        .filter((pill) => pill.dimension === dimension)
        .map((pill) => pill.sentenceWord)
        .join(' or '),
    )
    .join(' ');
}

export function noMatchSentence(
  organization: string,
  filters: DivisionFilters,
  sportName: string | undefined,
): string {
  const named = [wordsByDimension(filterPills(filters)), sportName?.toLowerCase(), 'league']
    .filter(Boolean)
    .join(' ');
  return `${organization} has no ${named}.`;
}

export interface RemovalInput {
  readonly facets: readonly LeagueFacet[];
  readonly filters: DivisionFilters;
  readonly sportLeagueCounts: SportCounts | undefined;
  readonly sport: Sport | undefined;
  readonly total: number;
  readonly queryFor: (without: DivisionFilters) => Params;
}

export function removalSuggestions(input: RemovalInput): RemovalSuggestion[] {
  const { facets, filters, sportLeagueCounts, sport, total, queryFor } = input;
  return filterPills(filters)
    .map((pill) => {
      const count = draftLeagueCount(facets, pill.without, sportLeagueCounts, sport, total) ?? 0;
      return {
        label: pill.removeLabel,
        count,
        text: `(${leagues(count)})`,
        query: queryFor(pill.without),
      };
    })
    .filter((suggestion) => suggestion.count > 0)
    .sort((a, b) => b.count - a.count);
}
