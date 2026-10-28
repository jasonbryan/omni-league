import { computed, inject } from '@angular/core';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { AuthService } from '../../core/auth/auth.service';
import { injectQuery, skipToken } from '../../core/data/convex';

/**
 * The counts beside the admin sidebar's sections, from the same queries as the Overview tiles: leagues are the published counter plus the drafts in the list.
 * A count is null while it loads or after it failed, and the sidebar then shows none.
 * The queries wait until Convex has accepted the token, so the first answer is the caller's own.
 */
export function injectAdminCounts(organizationId: () => Id<'organizations'>) {
  const auth = inject(AuthService);
  const args = () =>
    auth.convexAuthenticated() ? { organizationId: organizationId() } : skipToken;
  const published = injectQuery(api.leagues.publishedCount, args);
  const leagues = injectQuery(api.leagues.listForAdmin, args);
  const locations = injectQuery(api.locations.listForAdmin, args);
  const members = injectQuery(api.memberships.listForOrganization, args);
  return {
    leagues: computed(() => {
      const count = published.value();
      const rows = leagues.value();
      if (count === undefined || rows === undefined) return null;
      return count + rows.filter((row) => row.status !== 'published').length;
    }),
    locations: computed(() => locations.value()?.length ?? null),
    staff: computed(() => members.value()?.length ?? null),
  };
}
