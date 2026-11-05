import { computed, inject } from '@angular/core';
import type { Id } from '../../../../convex/_generated/dataModel';
import { AuthService } from '../../core/auth/auth.service';
import { api, injectQuery, skipToken } from '../../core/data/convex';

function leagueCount(published: number | undefined, drafts: number | undefined): number | null {
  return published === undefined || drafts === undefined ? null : published + drafts;
}

/** The queries wait until Convex has accepted the token, so the first answer is the caller's own. */
export function injectAdminCounts(organizationId: () => Id<'organizations'>) {
  const auth = inject(AuthService);
  const args = () =>
    auth.convexAuthenticated() ? { organizationId: organizationId() } : skipToken;
  const published = injectQuery(api.leagues.publishedCount, args);
  const drafts = injectQuery(api.leagues.draftCount, args);
  const locations = injectQuery(api.locations.listForAdmin, args);
  const staff = injectQuery(api.memberships.staffCount, args);
  return {
    leagues: computed(() => leagueCount(published.value(), drafts.value())),
    locations: computed(() => locations.value()?.length ?? null),
    staff: computed(() => staff.value() ?? null),
  };
}
