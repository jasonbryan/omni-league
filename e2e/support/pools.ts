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

/** Puts a team in a pool as another organizer's move does, without the page's knowing. Local runs only. */
export async function seedTeamPool(
  tenant: Tenant,
  tournamentSlug: string,
  teamName: string,
  pool: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H',
): Promise<void> {
  await convexRun('testing:setTeamPool', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    teamName,
    pool,
  });
}
