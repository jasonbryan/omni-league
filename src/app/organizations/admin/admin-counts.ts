import { computed, inject } from '@angular/core';
import type { Id } from '../../../../convex/_generated/dataModel';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';

function leagueCount(
  published: number | undefined,
  rows: readonly { status: string }[] | undefined,
): number | null {
  if (published === undefined || rows === undefined) return null;
  return published + rows.filter((row) => row.status !== 'published').length;
}

/** The queries wait until Convex has accepted the token, so the first answer is the caller's own. */
export function injectAdminCounts(organizationId: () => Id<'organizations'>) {
  const auth = inject(AuthService);
  const args = () =>
    auth.convexAuthenticated() ? { organizationId: organizationId() } : skipToken;
  const published = injectQuery(api.leagues.publishedCount, args);
  const leagues = injectQuery(api.leagues.listForAdmin, args);
  const locations = injectQuery(api.locations.listForAdmin, args);
  const members = injectQuery(api.memberships.listForOrganization, args);
  return {
    leagues: computed(() => leagueCount(published.value(), leagues.value())),
    locations: computed(() => locations.value()?.length ?? null),
    staff: computed(() => members.value()?.length ?? null),
  };
}
