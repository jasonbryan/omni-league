import type { PublicSeasonPage } from '../../../../convex/lib/publicPage';

/** The validator's type, not the handler's: a copy saved before a field existed lacks its optional fields. */
export type PublicSeasonData = PublicSeasonPage;

export interface PublicSeasonView {
  season: PublicSeasonData;
}
