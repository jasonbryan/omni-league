import { convexRun } from './convex';
import type { Tenant } from './tenant';

/** Teams with full rosters, registered in the order given, and the bracket made from them. Local runs only. */
export async function seedBracket(
  tenant: Tenant,
  tournamentSlug: string,
  teamNames: readonly string[],
): Promise<void> {
  await convexRun('testing:seedTournamentRosters', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    teams: teamNames.map((name) => ({ name })),
  });
  await convexRun('testing:seedTournamentBracket', {
    organizationSlug: tenant.slug,
    tournamentSlug,
  });
}
