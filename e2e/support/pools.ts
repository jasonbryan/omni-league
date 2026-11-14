import { convexRun } from './convex';
import type { Tenant } from './tenant';

/** Makes the tournament Pools, then bracket, as an organizer does on its details. Local runs only. */
export async function seedPoolsStructure(tenant: Tenant, tournamentSlug: string): Promise<void> {
  await convexRun('testing:setTournamentStructure', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    structure: 'pools',
  });
}
