/** Built from the id, never copied from the current URL. */
export function teamPath(teamId: string): string {
  return `/app/teams/${encodeURIComponent(teamId)}`;
}

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
function registerPath(
  orgSlug: string,
  leagueSlug: string,
  seasonSlug: string,
  way: string,
): string {
  return `/app/register/${[orgSlug, leagueSlug, seasonSlug].map(encodeURIComponent).join('/')}/${way}`;
}

export function registerTeamPath(orgSlug: string, leagueSlug: string, seasonSlug: string): string {
  return registerPath(orgSlug, leagueSlug, seasonSlug, 'team');
}

export function registerFreeAgentPath(
  orgSlug: string,
  leagueSlug: string,
  seasonSlug: string,
): string {
  return registerPath(orgSlug, leagueSlug, seasonSlug, 'free-agent');
}

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function registerTournamentTeamPath(orgSlug: string, tournamentSlug: string): string {
  return `/app/organizations/${[orgSlug, 'tournaments', tournamentSlug].map(encodeURIComponent).join('/')}/register`;
}
