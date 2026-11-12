import { organizationPath } from '../organization-path';

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function publicTournamentPath(orgSlug: string, tournamentSlug: string): string {
  return `${organizationPath(orgSlug)}/tournaments/${encodeURIComponent(tournamentSlug)}`;
}
