import {
  hasDivisionFilters,
  matchesDivisionFilters,
  scopedFilters,
  type DivisionFilters,
  type LeagueDivisionValues,
} from '../../../convex/lib/leagueFilters';
import type { Sport, SportCounts } from '../../../convex/lib/sports';
import { divisionFilterQuery, type FilterParam, type LeagueFacet } from './division-filters';

/** The facets query leaves out a league with no division values, so with no filter the count is the total, not the number of facets. */
export function draftLeagueCount(
  facets: readonly LeagueFacet[] | undefined,
  draft: DivisionFilters,
  sportLeagueCounts: SportCounts | undefined,
  sport: Sport | undefined,
  total: number,
): number | undefined {
  if (facets === undefined) return undefined;
  const filters = scopedFilters(sportLeagueCounts, sport, draft);
  if (!hasDivisionFilters(filters)) return total;
  // A facet's strings are only compared with the standard values a parsed draft holds.
  return facets.filter((facet) => matchesDivisionFilters(facet as LeagueDivisionValues, filters))
    .length;
}

export function showLeaguesLabel(count: number | undefined): string {
  if (count === undefined) return 'Show leagues';
  return `Show ${count} ${count === 1 ? 'league' : 'leagues'}`;
}

export interface HiddenInput {
  readonly name: string;
  readonly value: string;
}

/** A form that shows some dimensions still submits the whole draft, so Show in one never drops another's values. */
export function hiddenDraftInputs(
  draft: DivisionFilters,
  shown: readonly FilterParam[],
): HiddenInput[] {
  return Object.entries(divisionFilterQuery(draft))
    .filter(([name]) => !shown.includes(name as FilterParam))
    .flatMap(([name, values]) =>
      (values as readonly (string | number)[]).map((value) => ({ name, value: String(value) })),
    );
}

/** Offers each applied value with the facets, so a chip stays in place when a draft unchecks it. */
export function offeredFacets(
  facets: readonly LeagueFacet[],
  applied: DivisionFilters,
): LeagueFacet[] {
  return [
    ...facets,
    ...applied.gender.map((gender) => ({ gender })),
    ...applied.playersPerSide.map((playersPerSide) => ({ playersPerSide })),
    ...applied.level.map((level) => ({ level })),
    ...applied.ageGroup.map((ageGroup) => ({ ageGroup })),
  ];
}
