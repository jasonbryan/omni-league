import {
  MIN_ADVANCING_TEAMS,
  POOL_MESSAGES,
  poolIndexOf,
  type Pool,
  type PoolIssue,
} from './pools';
import type { Sport } from './sports';
import { crossPoolValues, pointsAmong, standingsOf, type StandingsGame } from './standings';

// Imports only `convex/lib` files that import nothing from the server, so the app can import it.

export interface PoolStanding {
  pool: Pool;
  /** In the pool's seed order, which separates teams that nothing else does. */
  teamIds: readonly string[];
  games: readonly StandingsGame[];
}

export type TieDecidedBy = 'headToHead' | 'seedOrder';

export interface PoolSeed {
  teamId: string;
  pool: Pool;
  /** The team's place in its pool, from 1, which tied teams take one after the other. */
  place: number;
  /** Set for a team that shares its place in the pool with another, with the place they share. */
  tie: { place: number; decidedBy: TieDecidedBy } | null;
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

/** Whether the advancing teams hold `advance` teams of each pool, each in the pool it belongs to. */
export function checkAdvancing(
  advancing: readonly { teamId: string; pool: Pool }[],
  pools: readonly Pool[],
  advance: number,
): PoolIssue | null {
  const teamIds = new Set(advancing.map((team) => team.teamId));
  const holdsEach = pools.every(
    (pool) => advancing.filter((team) => team.pool === pool).length === advance,
  );
  if (
    teamIds.size === advancing.length &&
    holdsEach &&
    advancing.length === advance * pools.length
  ) {
    return null;
  }
  return { code: 'advancingInvalid', message: POOL_MESSAGES.advancingInvalid(advance) };
}

function compareValues(first: readonly number[], second: readonly number[]): number {
  for (const [index, value] of first.entries()) {
    if (value !== second[index]) return second[index] - value;
  }
  return 0;
}

/** Teams level in a pool: the one that scored more points in the games between them first, else the pool's seed order. */
function orderedPool({ pool, teamIds, games }: PoolStanding, sport: Sport) {
  const rows = standingsOf(sport, teamIds, games);
  const ordered: { teamId: string; place: number; tie: PoolSeed['tie']; values: number[] }[] = [];
  for (let start = 0; start < rows.length;) {
    const band = rows.filter((row) => row.place === rows[start].place);
    const points = pointsAmong(
      band.map((row) => row.teamId),
      games,
    );
    const separated = new Set(points.values()).size > 1;
    const tie: PoolSeed['tie'] =
      band.length > 1
        ? { place: rows[start].place, decidedBy: separated ? 'headToHead' : 'seedOrder' }
        : null;
    const inOrder = [...band].sort((a, b) => points.get(b.teamId)! - points.get(a.teamId)!);
    for (const row of inOrder) {
      ordered.push({
        teamId: row.teamId,
        place: ordered.length + 1,
        tie,
        values: crossPoolValues(sport, row),
      });
    }
    start += band.length;
  }
  return ordered.map((team) => ({ ...team, pool }));
}

/** Every team: the pool winners first, then the runners-up, and so on, each place ordered across the pools. */
export function seedsFromPools(sport: Sport, pools: readonly PoolStanding[]): PoolSeed[] {
  return pools
    .flatMap((standing) => orderedPool(standing, sport))
    .sort(
      (a, b) =>
        a.place - b.place ||
        compareValues(a.values, b.values) ||
        poolIndexOf(a.pool) - poolIndexOf(b.pool),
    )
    .map(({ teamId, pool, place, tie }) => ({ teamId, pool, place, tie }));
}
