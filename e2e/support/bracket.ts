import type { Score } from '../../convex/lib/sports';
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

export type SeededResult = { score: Score } | { forfeitSide: 0 | 1 };

/** One result for the game in a round and slot, through the writer the organizer's page uses, with the score rules. Local runs only. */
export async function seedResult(
  tenant: Tenant,
  tournamentSlug: string,
  game: { round: number; slot: number },
  result: SeededResult,
): Promise<void> {
  await convexRun('testing:seedTournamentResult', {
    organizationSlug: tenant.slug,
    tournamentSlug,
    ...game,
    ...result,
  });
}
