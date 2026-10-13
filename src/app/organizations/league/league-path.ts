/**
 * The league management page's path (#125): `/app/organizations/<org>/leagues/<league>`. Built from
 * the slugs, never copied from the current URL, which can carry a query string or a fragment.
 */
export function leaguePath(orgSlug: string, leagueSlug: string): string {
  return `/app/organizations/${encodeURIComponent(orgSlug)}/leagues/${encodeURIComponent(leagueSlug)}`;
}
