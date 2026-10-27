import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

export type PublicOrganizationHeader = NonNullable<
  FunctionReturnType<typeof api.organizations.getPublicPage>
>;

export type PublicOrganizationPage = PublicOrganizationHeader & {
  leagues: FunctionReturnType<typeof api.organizations.listPublicLeagues>['rows'];
  locations: FunctionReturnType<typeof api.organizations.listPublicLocations>['rows'];
};

/** Built from the slug, never copied from the current URL, which can carry `?ott=` or a fragment. The path is explicit because `<base href="/">` would resolve a bare `#league-1` to `/#league-1`. */
export function organizationPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}`;
}

export type PublicSport = PublicOrganizationHeader['sports'][number];

/** Built from the slug and the segment, never copied from the current URL, which can carry a query string or a fragment. */
export function sportViewPath(orgSlug: string, segment: string): string {
  return `${organizationPath(orgSlug)}/sports/${encodeURIComponent(segment)}`;
}

/** The bare path, then `?page=N` only when N is more than 1. Built from the query result's page number, an integer, never the request's query string. */
export function sportViewCanonicalPath(orgSlug: string, segment: string, page: number): string {
  const path = sportViewPath(orgSlug, segment);
  return page > 1 ? `${path}?page=${page}` : path;
}
