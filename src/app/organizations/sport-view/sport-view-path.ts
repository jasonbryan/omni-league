import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import { organizationPath, type PublicOrganizationHeader } from '../organization-path';

/** One sport of an organization, as `organizations:getPublicPage` lists it (#101). */
export type PublicSport = PublicOrganizationHeader['sports'][number];

/** One page of a sport's published leagues, as `organizations:listPublicLeagues` returns it. */
export type PublicSportLeagues = FunctionReturnType<typeof api.organizations.listPublicLeagues>;

/**
 * What the sport view shows (#114): the organization's header (the sidebar, the breadcrumb, and
 * the counts under the title), its entry for the sport, and the page of leagues shown.
 */
export interface SportView {
  organization: PublicOrganizationHeader;
  sport: PublicSport;
  leagues: PublicSportLeagues;
}

/**
 * The sport view's path, `/organizations/<org>/sports/<segment>`. Links, the canonical, and "Try
 * again" are built from the slug and the segment, never copied from the current URL, which can
 * carry a query string or a fragment.
 */
export function sportViewPath(orgSlug: string, segment: string): string {
  return `${organizationPath(orgSlug)}/sports/${encodeURIComponent(segment)}`;
}

/**
 * The canonical path of the sport view for the page of leagues shown: the bare path, then
 * `?page=N` only when N is more than 1. Built from the query result's page number, an integer,
 * never the request's query string.
 */
export function sportViewCanonicalPath(orgSlug: string, segment: string, page: number): string {
  const path = sportViewPath(orgSlug, segment);
  return page > 1 ? `${path}?page=${page}` : path;
}

/** The line under the sport's name: `12 leagues at 3 locations` (`1 league at 1 location`). */
export function sportSummary(sport: Pick<PublicSport, 'leagueCount' | 'locationCount'>): string {
  const leagues = sport.leagueCount === 1 ? 'league' : 'leagues';
  const locations = sport.locationCount === 1 ? 'location' : 'locations';
  return `${sport.leagueCount} ${leagues} at ${sport.locationCount} ${locations}`;
}
