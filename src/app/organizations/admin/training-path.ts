import { adminPath } from './admin-path';

/** Built from the slugs, never copied from the current URL, which can carry a query string or a fragment. */
export function trainingPath(orgSlug: string, trainingSlug: string): string {
  return adminPath(orgSlug, `training/${encodeURIComponent(trainingSlug)}`);
}
