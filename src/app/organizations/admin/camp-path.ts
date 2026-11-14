import { adminPath } from './admin-path';

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function campPath(orgSlug: string, campSlug: string): string {
  return adminPath(orgSlug, `camps/${encodeURIComponent(campSlug)}`);
}
