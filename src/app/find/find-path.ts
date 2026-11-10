import type { Params } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import { sportSegment, type Sport } from '../../../convex/lib/sports';
import { divisionFilterQuery } from '../organizations/division-filters';

export type FindResults = FunctionReturnType<typeof api.search.leagues>;

export type FindSportResults = FunctionReturnType<typeof api.search.leaguesBySport>;

export type FindResultRow = FindResults['rows'][number];

export type FindOrganizations = FunctionReturnType<typeof api.search.organizations>;

export type FindOrganizationRow = FindOrganizations['rows'][number];

export const FIND_PATH = '/leagues';

/** Built from a page number, an integer, never copied from the current URL. */
export function organizationsPath(page: number): string {
  return page > 1 ? `${FIND_PATH}?page=${page}` : FIND_PATH;
}

export interface FindView {
  readonly sport?: Sport;
  readonly filters?: DivisionFilters;
  readonly page?: number;
}

/** In the order the form submits them: the search, the sport, the filters, the page. */
export function findQuery(q: string, view: FindView = {}): Params {
  const { sport, filters = NO_DIVISION_FILTERS, page = 1 } = view;
  return {
    ...(q !== '' && { q }),
    ...(sport !== undefined && { sport: sportSegment(sport) }),
    ...divisionFilterQuery(filters),
    ...(page > 1 && { page }),
  };
}

/** Built from the parsed search, sport, filters, and page, never copied from the current URL, which can carry other parameters. */
export function findPath(q: string, view: FindView = {}): string {
  const query = Object.entries(findQuery(q, view))
    .flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map(
        (one) => `${name}=${encodeURIComponent(String(one))}`,
      ),
    )
    .join('&');
  return query === '' ? FIND_PATH : `${FIND_PATH}?${query}`;
}
