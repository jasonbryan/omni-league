import type { PublicSeasonPage, PublicTeams } from '../../../../convex/lib/publicPage';

/** The validator's type, not the handler's: a copy saved before a field existed lacks its optional fields. */
export type PublicSeasonData = PublicSeasonPage;

export type PublicSeasonTeams = PublicTeams;

export interface PublicSeasonView {
  season: PublicSeasonData;
  /** Absent until the teams query answers, and offline, where it has no saved copy. */
  teams?: PublicSeasonTeams;
}
