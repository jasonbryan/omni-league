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
