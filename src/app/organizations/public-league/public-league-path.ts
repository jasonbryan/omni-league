import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import type { PublicOrganizationHeader } from '../organization-path';
import { organizationPath } from '../organization-path';

/** A found league's header, as `leagues:getPublicPage` returns it. */
export type PublicLeagueHeader = NonNullable<FunctionReturnType<typeof api.leagues.getPublicPage>>;

/** One page of a league's published seasons, as `seasons:listPublic` returns it. */
export type PublicLeagueSeasons = FunctionReturnType<typeof api.seasons.listPublic>;

/**
 * What the public league page shows (#127): the organization's header (for the sidebar's sports
 * and totals), the league's header, and the page of seasons shown.
 */
export interface PublicLeagueView {
  organization: PublicOrganizationHeader;
  league: PublicLeagueHeader;
  seasons: PublicLeagueSeasons;
}

/**
 * The public league page's path, `/organizations/<org>/leagues/<league>`. Links, the canonical, and
 * "Try again" are built from the slugs, never copied from the current URL, which can carry a query
 * string or a fragment.
 */
export function publicLeaguePath(orgSlug: string, leagueSlug: string): string {
  return `${organizationPath(orgSlug)}/leagues/${encodeURIComponent(leagueSlug)}`;
}

/**
 * The season page's path, `/organizations/<org>/leagues/<league>/seasons/<season>` (#128).
 */
export function publicSeasonPath(orgSlug: string, leagueSlug: string, seasonSlug: string): string {
  return `${publicLeaguePath(orgSlug, leagueSlug)}/seasons/${encodeURIComponent(seasonSlug)}`;
}

/**
 * The canonical path of the league page for the page of seasons shown: the bare path, then
 * `?page=N` only when N is more than 1. Built from the query result's page number, an integer,
 * never the request's query string.
 */
export function publicLeagueCanonicalPath(
  orgSlug: string,
  leagueSlug: string,
  page: number,
): string {
  const path = publicLeaguePath(orgSlug, leagueSlug);
  return page > 1 ? `${path}?page=${page}` : path;
}
