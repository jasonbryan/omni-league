export function leaguePath(orgSlug: string, leagueSlug: string): string {
  return `/app/organizations/${encodeURIComponent(orgSlug)}/leagues/${encodeURIComponent(leagueSlug)}`;
}
