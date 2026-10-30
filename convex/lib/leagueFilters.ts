import { v } from 'convex/values';
import {
  ageGroupValidator,
  genderValidator,
  isLevelOfSport,
  isPlayersPerSideOfSport,
  standardLevelValidator,
  type AgeGroup,
  type Gender,
  type StandardLevel,
} from './divisions';
import type { Sport, SportCounts } from './sports';

// Imports stay `convex/values`, `./divisions`, and `./sports` so the Angular app applies the same rules.

export const divisionFilterArgs = {
  gender: v.optional(v.array(genderValidator)),
  playersPerSide: v.optional(v.array(v.number())),
  level: v.optional(v.array(standardLevelValidator)),
  ageGroup: v.optional(v.array(ageGroupValidator)),
};

export interface DivisionFilters {
  readonly gender: readonly Gender[];
  readonly playersPerSide: readonly number[];
  readonly level: readonly StandardLevel[];
  readonly ageGroup: readonly AgeGroup[];
}

export const NO_DIVISION_FILTERS: DivisionFilters = {
  gender: [],
  playersPerSide: [],
  level: [],
  ageGroup: [],
};

export function hasDivisionFilters(filters: DivisionFilters): boolean {
  const { gender, playersPerSide, level, ageGroup } = filters;
  return gender.length + playersPerSide.length + level.length + ageGroup.length > 0;
}

export function sportsWithLeagues(counts: SportCounts | undefined): Sport[] {
  return (Object.keys(counts ?? {}) as Sport[]).filter((sport) => (counts?.[sport] ?? 0) > 0);
}

/** The sport whose formats and levels a filter may name: the sport view's, or the only sport the organization plays. */
export function filterSport(sport: Sport | undefined, sports: readonly Sport[]): Sport | undefined {
  return sport ?? (sports.length === 1 ? sports[0] : undefined);
}

/** With several sports a format or a level means a different thing in each, so neither applies; one outside the sport's lists is unknown. */
export function filtersInScope(
  filters: Partial<DivisionFilters>,
  sport: Sport | undefined,
): DivisionFilters {
  return {
    gender: filters.gender ?? [],
    playersPerSide:
      sport === undefined
        ? []
        : (filters.playersPerSide ?? []).filter((count) => isPlayersPerSideOfSport(sport, count)),
    level:
      sport === undefined
        ? []
        : (filters.level ?? []).filter((level) => isLevelOfSport(sport, level)),
    ageGroup: filters.ageGroup ?? [],
  };
}

/** The filters a query applies: both the backend and the page read the organization's sports from `sportLeagueCounts`. */
export function scopedFilters(
  sportLeagueCounts: SportCounts | undefined,
  sport: Sport | undefined,
  filters: Partial<DivisionFilters>,
): DivisionFilters {
  return filtersInScope(filters, filterSport(sport, sportsWithLeagues(sportLeagueCounts)));
}

export interface LeagueDivisionValues {
  readonly gender?: Gender;
  readonly playersPerSide?: number;
  readonly level?: StandardLevel;
  readonly ageGroup?: AgeGroup;
}

function matchesAny<T>(chosen: readonly T[], value: T | undefined): boolean {
  return chosen.length === 0 || (value !== undefined && chosen.includes(value));
}

/** Values of one dimension match any, dimensions combine. A league with no value in a dimension never matches a filter on it. */
export function matchesDivisionFilters(
  league: LeagueDivisionValues,
  filters: DivisionFilters,
): boolean {
  return (
    matchesAny(filters.gender, league.gender) &&
    matchesAny(filters.playersPerSide, league.playersPerSide) &&
    matchesAny(filters.level, league.level) &&
    matchesAny(filters.ageGroup, league.ageGroup)
  );
}
