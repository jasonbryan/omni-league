import type { Params } from '@angular/router';
import { NO_DIVISION_FILTERS, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import type { ProgramType } from '../../../convex/lib/programs';
import { sportSegment, type Sport } from '../../../convex/lib/sports';
import { divisionFilterQuery } from '../organizations/division-filters';

export const FIND_PATH = '/programs';

/** Built from a page number, an integer, never copied from the current URL. */
export function organizationsPath(page: number): string {
  return page > 1 ? `${FIND_PATH}?page=${page}` : FIND_PATH;
}

export interface FindView {
  readonly type?: ProgramType;
  readonly sport?: Sport;
  readonly filters?: DivisionFilters;
  readonly page?: number;
}

/** In the order the form submits them: the type, the search, the sport, the filters, the page. */
export function findQuery(q: string, view: FindView = {}): Params {
  const { type, sport, filters = NO_DIVISION_FILTERS, page = 1 } = view;
  return {
    ...(type !== undefined && { type }),
    ...(q !== '' && { q }),
    ...(sport !== undefined && { sport: sportSegment(sport) }),
    ...divisionFilterQuery(filters),
    ...(page > 1 && { page }),
  };
}

/** Built from the parsed search, type, sport, filters, and page, never copied from the current URL, which can carry other parameters. */
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
