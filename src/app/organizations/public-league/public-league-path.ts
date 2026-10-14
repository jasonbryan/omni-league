import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import type { PublicOrganizationHeader } from '../organization-path';
import { organizationPath } from '../organization-path';

export type PublicLeagueHeader = NonNullable<FunctionReturnType<typeof api.leagues.getPublicPage>>;

export type PublicLeagueSeasons = FunctionReturnType<typeof api.seasons.listPublic>;

export interface PublicLeagueView {
  organization: PublicOrganizationHeader;
  league: PublicLeagueHeader;
  seasons: PublicLeagueSeasons;
}

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function publicLeaguePath(orgSlug: string, leagueSlug: string): string {
  return `${organizationPath(orgSlug)}/leagues/${encodeURIComponent(leagueSlug)}`;
}

export function publicSeasonPath(orgSlug: string, leagueSlug: string, seasonSlug: string): string {
  return `${publicLeaguePath(orgSlug, leagueSlug)}/seasons/${encodeURIComponent(seasonSlug)}`;
}

/** Built from the query result's page number, an integer, never the request's query string. */
export function publicLeagueCanonicalPath(
  orgSlug: string,
  leagueSlug: string,
  page: number,
): string {
  const path = publicLeaguePath(orgSlug, leagueSlug);
  return page > 1 ? `${path}?page=${page}` : path;
}
