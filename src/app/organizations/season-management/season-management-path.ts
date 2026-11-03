import { leaguePath } from '../league/league-path';

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function seasonManagementPath(
  orgSlug: string,
  leagueSlug: string,
  seasonSlug: string,
): string {
  return `${leaguePath(orgSlug, leagueSlug)}/seasons/${encodeURIComponent(seasonSlug)}`;
}
