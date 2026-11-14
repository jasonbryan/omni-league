import { organizationPath } from '../organization-path';

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function publicCampPath(orgSlug: string, campSlug: string): string {
  return `${organizationPath(orgSlug)}/camps/${encodeURIComponent(campSlug)}`;
}
