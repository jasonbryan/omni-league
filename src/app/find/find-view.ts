import type { ParamMap } from '@angular/router';
import { filtersInScope, type DivisionFilters } from '../../../convex/lib/leagueFilters';
import { PROGRAM_TYPES, type ProgramType } from '../../../convex/lib/programs';
import { sportFromSegment, type Sport } from '../../../convex/lib/sports';
import { parseDivisionFilters } from '../organizations/division-filters';

export interface ParsedFindView {
  readonly type: ProgramType | undefined;
  readonly sport: Sport | undefined;
  readonly filters: DivisionFilters;
}

/**
 * Only values from the standard lists reach the args, the links, or the HTML. The first `type` and the first `sport` are used, so a repeated parameter cannot change
 * the view, and a format or level appears only with a sport, whose lists it belongs to.
 */
export function parseFindView(params: ParamMap): ParsedFindView {
  const [segment = ''] = params.getAll('sport');
  const [typeValue = ''] = params.getAll('type');
  const sport = sportFromSegment(segment);
  return {
    type: PROGRAM_TYPES.find((type) => type === typeValue),
    sport,
    filters: filtersInScope(parseDivisionFilters(params, sport), sport),
  };
}
