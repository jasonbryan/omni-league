import type { Params } from '@angular/router';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

export type PublicOrganizationHeader = NonNullable<
  FunctionReturnType<typeof api.organizations.getPublicPage>
>;

export type PublicLeagueRows = FunctionReturnType<
  typeof api.organizations.listPublicLeagues
>['rows'];

export type PublicLocationRows = FunctionReturnType<
  typeof api.organizations.listPublicLocations
>['rows'];

export type PublicOpenSeasonRows = FunctionReturnType<typeof api.seasons.listOpenForOrganization>;

export type PublicOrganizationPage = PublicOrganizationHeader & {
  leagues: PublicLeagueRows;
  locations: PublicLocationRows;
  openSeasons?: PublicOpenSeasonRows;
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

export type PagedList = 'leagues' | 'locations';

export type ListPages = Readonly<Record<PagedList, number>>;

/** The sport view names its leagues page `page`, which links already shared use. */
export function listPagesQuery(pages: ListPages, sportView: boolean): Params {
  return {
    ...(pages.leagues > 1 && { [sportView ? 'page' : 'leagues']: pages.leagues }),
    ...(pages.locations > 1 && { locations: pages.locations }),
  };
}

/** Built from page numbers, integers from `parseListPage` or a query result, never the request's query string. */
export function listPagesPath(slug: string, segment: string | undefined, pages: ListPages): string {
  const path = segment === undefined ? organizationPath(slug) : sportViewPath(slug, segment);
  const query = Object.entries(listPagesQuery(pages, segment !== undefined))
    .map(([name, page]) => `${name}=${page}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

/** The links of one list's control, each keeping the other list on its page. */
export function pageQueryFor(
  list: PagedList,
  pages: ListPages,
  sportView: boolean,
): (page: number) => Params {
  return (page) => listPagesQuery({ ...pages, [list]: page }, sportView);
}
