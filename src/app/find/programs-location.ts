import type { ParamMap } from '@angular/router';
import { parseSearchQuery } from '../../../convex/lib/searchQuery';
import { parseListPage } from '../core/list-page';
import { findPath } from './find-path';
import { parseFindView } from './find-view';

/** Built from the known parameters only (the search, the sport, the division filters, and the page), never from the raw query string, so a parameter the page does not read, a one-time token for one, appears nowhere in the redirect. */
export function programsLocation(params: ParamMap): string {
  const { sport, filters } = parseFindView(params);
  return findPath(parseSearchQuery(params.getAll('q')), {
    type: 'league',
    sport,
    filters,
    page: parseListPage(params.getAll('page')),
  });
}
