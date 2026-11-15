import {
  MIN_ADVANCING_TEAMS,
  POOL_MESSAGES,
  poolIndexOf,
  type Pool,
  type PoolIssue,
} from './pools';
import type { Sport } from './sports';
import { crossPoolValues, standingsOf, type StandingsGame } from './standings';

// Imports only `convex/lib` files that import nothing from the server, so the app can import it.

export interface PoolStanding {
  pool: Pool;
  /** In the pool's seed order, which separates teams that nothing else does. */
  teamIds: readonly string[];
  games: readonly StandingsGame[];
}

export interface PoolSeed {
  teamId: string;
  pool: Pool;
  /** The team's place in its pool, from 1; teams level in a pool take places in seed order. */
  place: number;
}

export function checkAdvance(poolSizes: readonly number[], advance: number): PoolIssue | null {
  const smallest = Math.min(...poolSizes);
  if (!Number.isInteger(advance) || advance < 1 || advance > smallest) {
    return { code: 'advanceCount', message: POOL_MESSAGES.advanceCount(smallest) };
  }
  if (advance * poolSizes.length < MIN_ADVANCING_TEAMS) {
    return { code: 'advanceTotal', message: POOL_MESSAGES.advanceTotal };
  }
  return null;
}

function compareValues(first: readonly number[], second: readonly number[]): number {
  for (const [index, value] of first.entries()) {
    if (value !== second[index]) return second[index] - value;
  }
  return 0;
}

/** Every team: the pool winners first, then the runners-up, and so on, each place ordered across the pools. */
export function seedsFromPools(sport: Sport, pools: readonly PoolStanding[]): PoolSeed[] {
  const ranked = pools.flatMap(({ pool, teamIds, games }) =>
    standingsOf(sport, teamIds, games).map((row, index) => ({
      teamId: row.teamId,
      pool,
      place: index + 1,
      values: crossPoolValues(sport, row),
    })),
  );
  return ranked
    .sort(
      (a, b) =>
        a.place - b.place ||
        compareValues(a.values, b.values) ||
        poolIndexOf(a.pool) - poolIndexOf(b.pool),
    )
    .map(({ teamId, pool, place }) => ({ teamId, pool, place }));
}
