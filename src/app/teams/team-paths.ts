/** Built from the id, never copied from the current URL. */
export function teamPath(teamId: string): string {
  return `/app/teams/${encodeURIComponent(teamId)}`;
}

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function registerTeamPath(orgSlug: string, leagueSlug: string, seasonSlug: string): string {
  return `/app/register/${[orgSlug, leagueSlug, seasonSlug].map(encodeURIComponent).join('/')}/team`;
}
