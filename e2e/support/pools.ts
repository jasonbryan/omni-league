import type { Score } from '../../convex/lib/sports';
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

/** Splits the confirmed teams into pools and creates their games, as the organizer's two buttons do. Local runs only. */
export async function seedPoolPlay(
  tenant: Tenant,
  tournamentSlug: string,
  poolCount: number,
): Promise<void> {
  await convexRun('testing:seedTournamentPools', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    poolCount,
  });
}

export type SeededPoolResult = { score: Score } | { forfeitTeamName: string };

/** One pool result through the writer the organizer's page uses; `score.a` is the first named team's. Local runs only. */
export async function seedPoolResult(
  tenant: Tenant,
  tournamentSlug: string,
  teams: readonly [string, string],
  result: SeededPoolResult,
): Promise<void> {
  await convexRun('testing:seedPoolResult', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    teams: [...teams],
    ...result,
  });
}

/** Creates the bracket from the pool finish as the organizer's Create bracket does, without its order. Every pool game needs a result. Local runs only. */
export async function seedPoolBracket(
  tenant: Tenant,
  tournamentSlug: string,
  advancePerPool: number,
): Promise<void> {
  await convexRun('testing:seedPoolBracket', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    advancePerPool,
  });
}
