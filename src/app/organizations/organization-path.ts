import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

/** A found organization's header and totals, as `organizations:getPublicPage` returns it. */
export type PublicOrganizationHeader = NonNullable<
  FunctionReturnType<typeof api.organizations.getPublicPage>
>;

/**
 * What the organization page shows (#100): the header and totals, with the rows of the page shown
 * of `organizations:listPublicLeagues` and `organizations:listPublicLocations`.
 */
export type PublicOrganizationPage = PublicOrganizationHeader & {
  leagues: FunctionReturnType<typeof api.organizations.listPublicLeagues>['rows'];
  locations: FunctionReturnType<typeof api.organizations.listPublicLocations>['rows'];
};

/**
 * The organization page's path, `/organizations/<slug>`. Links, the canonical, and "Try again" are
 * built from it, never copied from the current URL, which can carry `?ott=` (ADR 0008) or a
 * fragment. The path is explicit because `<base href="/">` would resolve a bare `#league-1` to
 * `/#league-1`.
 */
export function organizationPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}`;
}
