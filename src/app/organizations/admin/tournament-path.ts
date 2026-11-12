import { adminPath } from './admin-path';

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function tournamentPath(orgSlug: string, tournamentSlug: string): string {
  return adminPath(orgSlug, `tournaments/${encodeURIComponent(tournamentSlug)}`);
}
