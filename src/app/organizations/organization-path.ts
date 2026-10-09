import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';

/** A found organization's public page, as `organizations:getPublicPage` returns it. */
export type PublicOrganizationPage = NonNullable<
  FunctionReturnType<typeof api.organizations.getPublicPage>
>;

/**
 * The organization page's path, `/organizations/<slug>`. Links, the canonical, and "Try again" are
 * built from it, never copied from the current URL, which can carry `?ott=` (ADR 0008) or a
 * fragment. The path is explicit because `<base href="/">` would resolve a bare `#league-1` to
 * `/#league-1`.
 */
export function organizationPath(slug: string): string {
  return `/organizations/${encodeURIComponent(slug)}`;
}
