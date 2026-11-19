import {
  MIN_ADVANCING_TEAMS,
  POOL_MESSAGES,
  poolIndexOf,
  type Pool,
  type PoolIssue,
} from './pools';
import type { Sport } from './sports';
import {
  allPlayedEachOther,
  crossPoolValues,
  pointsAmong,
  standingsOf,
  type StandingsGame,
  type StandingsRow,
} from './standings';

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
  /** The team's place in its pool, from 1, which tied teams take one after the other. */
  place: number;
  /** Set for a team that shares its place in the pool with another: the place they share, and a number that two of them share only when nothing separated them but seed order. */
  tie: { place: number; level: number } | null;
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

/**
 * Teams level in a pool, best first: the points rule is applied again to each group it leaves level, and the pool's seed order
 * separates what is still level. The rule needs every two of the group to have played, as head-to-head does.
 * `level` is the pool index of the first team of the group a team ends in.
 */
function byPointsAmong(
  group: readonly string[],
  games: readonly StandingsGame[],
  firstIndex: number,
): { teamId: string; level: number }[] {
  const points = pointsAmong(group, games);
  if (!allPlayedEachOther(group, games) || new Set(points.values()).size === 1) {
    return group.map((teamId) => ({ teamId, level: firstIndex }));
  }
  const ordered: { teamId: string; level: number }[] = [];
  const bestFirst = [...new Set(points.values())].sort((a, b) => b - a);
  for (const value of bestFirst) {
    const level = group.filter((teamId) => points.get(teamId) === value);
    ordered.push(...byPointsAmong(level, games, firstIndex + ordered.length));
  }
  return ordered;
}

export interface PoolOrderEntry {
  teamId: string;
  pool: Pool;
  /** The team's place in the pool, from 1, which tied teams take one after the other. */
  place: number;
  tie: PoolSeed['tie'];
  values: number[];
  row: StandingsRow;
}

export function poolOrder(sport: Sport, { pool, teamIds, games }: PoolStanding): PoolOrderEntry[] {
  const rows = standingsOf(sport, teamIds, games);
  const rowOf = new Map(rows.map((row) => [row.teamId, row]));
  const ordered: Omit<PoolOrderEntry, 'pool'>[] = [];
  const valuesOf = new Map(rows.map((row) => [row.teamId, crossPoolValues(sport, row)]));
  for (let start = 0; start < rows.length;) {
    const band = rows.filter((row) => row.place === rows[start].place);
    const ids = band.map((row) => row.teamId);
    const inOrder =
      band.length > 1 ? byPointsAmong(ids, games, start) : [{ teamId: ids[0], level: start }];
    for (const { teamId, level } of inOrder) {
      ordered.push({
        teamId,
        place: ordered.length + 1,
        tie: band.length > 1 ? { place: rows[start].place, level } : null,
        values: valuesOf.get(teamId)!,
        row: rowOf.get(teamId)!,
      });
    }
    start += band.length;
  }
  return ordered.map((team) => ({ ...team, pool }));
}

/** Every team: the pool winners first, then the runners-up, and so on, each place ordered across the pools. */
export function seedsFromPools(sport: Sport, pools: readonly PoolStanding[]): PoolSeed[] {
  return pools
    .flatMap((standing) => poolOrder(sport, standing))
    .sort(
      (a, b) =>
        a.place - b.place ||
        compareValues(a.values, b.values) ||
        poolIndexOf(a.pool) - poolIndexOf(b.pool),
    )
    .map(({ teamId, pool, place, tie }) => ({ teamId, pool, place, tie }));
}
