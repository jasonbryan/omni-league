import { v, type Infer } from 'convex/values';
import { formatCalendarDate } from './seasonInput';

// Imports only `convex/values` and `convex/lib` files that import nothing from the server, so `convex/schema.ts`, `convex/lib/bracket.ts`, and the app can import it.

export const MIN_POOLS = 2;
export const MAX_POOLS = 8;
export const MIN_POOL_SIZE = 3;
export const MAX_POOL_SIZE = 8;
export const MIN_POOL_PLAY_TEAMS = MIN_POOLS * MIN_POOL_SIZE;
export const MAX_POOL_PLAY_TEAMS = MAX_POOLS * MAX_POOL_SIZE;

export const poolValidator = v.union(
  v.literal('A'),
  v.literal('B'),
  v.literal('C'),
  v.literal('D'),
  v.literal('E'),
  v.literal('F'),
  v.literal('G'),
  v.literal('H'),
);

export type Pool = Infer<typeof poolValidator>;

const POOL_NAMES: readonly Pool[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function poolNameAt(index: number): Pool {
  return POOL_NAMES[index];
}

export function poolIndexOf(pool: Pool): number {
  return POOL_NAMES.indexOf(pool);
}

/** The most games one pool plays, and so the most a tournament's pools play in all. */
export const MAX_POOL_GAMES = MAX_POOLS * ((MAX_POOL_SIZE * (MAX_POOL_SIZE - 1)) / 2);

export const POOL_REFUSAL_CODES = [
  'teamLimits',
  'poolCount',
  'noSuchPool',
  'poolSize',
  'notPools',
  'notSplit',
  'poolRegistrationOpen',
  'poolGamesExist',
  'poolResultEntered',
  'notInPools',
  'samePool',
  'noPoolGames',
  'poolsFirst',
  'structureLocked',
] as const;

export type PoolRefusalCode = (typeof POOL_REFUSAL_CODES)[number];

export interface PoolIssue {
  code: PoolRefusalCode;
  message: string;
}

const teamsText = (count: number) => `${count} ${count === 1 ? 'team' : 'teams'}`;

export const POOL_MESSAGES = {
  teamLimits: `Pools need ${MIN_POOL_PLAY_TEAMS} to ${MAX_POOL_PLAY_TEAMS} confirmed teams.`,
  poolCount: `Choose ${MIN_POOLS} to ${MAX_POOLS} pools.`,
  noSuchPool: (pool: Pool) => `Pool ${pool} is not one of the pools.`,
  poolSize: (pool: Pool, count: number) =>
    `Pool ${pool} would have ${teamsText(count)}. Each pool needs ${MIN_POOL_SIZE} to ${MAX_POOL_SIZE} teams.`,
  notPools: 'This tournament is Bracket only, so it has no pools.',
  notSplit: 'Split the teams into pools first.',
  poolRegistrationOpen: (registrationDeadline: string) =>
    `Registration is open until ${formatCalendarDate(registrationDeadline)}. Split the teams into pools after it closes.`,
  poolGamesExist: 'This tournament has pool games already. Recreate them to replace them.',
  poolResultEntered: 'A pool result is entered, so the pools cannot change.',
  notInPools: (teamName: string) => `${teamName} is not in a pool.`,
  samePool: (teamName: string, pool: Pool) => `${teamName} is in Pool ${pool} already.`,
  noPoolGames: 'This tournament has no pool games.',
  poolsFirst: 'This tournament plays pools first. Its bracket is created after pool play.',
  structureLocked: 'Games are created, so the structure cannot change.',
  setsPerGameLocked: 'Sets per game cannot change once the pool games are created.',
} as const;

/** Seeds from 1, in the order the pools take them: one row at a time, each row running the other way from the last. */
export function snakeSplit(teamCount: number, poolCount: number): number[][] {
  const pools: number[][] = Array.from({ length: poolCount }, () => []);
  for (let index = 0; index < teamCount; index++) {
    const row = Math.floor(index / poolCount);
    const column = index % poolCount;
    pools[row % 2 === 0 ? column : poolCount - 1 - column].push(index + 1);
  }
  return pools;
}

export function checkPoolSizes(sizes: readonly number[]): PoolIssue | null {
  if (sizes.length < MIN_POOLS) return { code: 'poolCount', message: POOL_MESSAGES.poolCount };
  const index = sizes.findIndex((size) => size < MIN_POOL_SIZE || size > MAX_POOL_SIZE);
  if (index === -1) return null;
  return { code: 'poolSize', message: POOL_MESSAGES.poolSize(poolNameAt(index), sizes[index]) };
}

export function checkSplit(teamCount: number, poolCount: number): PoolIssue | null {
  if (teamCount < MIN_POOL_PLAY_TEAMS || teamCount > MAX_POOL_PLAY_TEAMS) {
    return { code: 'teamLimits', message: POOL_MESSAGES.teamLimits };
  }
  if (!Number.isInteger(poolCount) || poolCount < MIN_POOLS || poolCount > MAX_POOLS) {
    return { code: 'poolCount', message: POOL_MESSAGES.poolCount };
  }
  return checkPoolSizes(snakeSplit(teamCount, poolCount).map((seeds) => seeds.length));
}

export function poolCountsFor(teamCount: number): number[] {
  const counts: number[] = [];
  for (let poolCount = MIN_POOLS; poolCount <= MAX_POOLS; poolCount++) {
    if (checkSplit(teamCount, poolCount) === null) counts.push(poolCount);
  }
  return counts;
}

export function poolSizesAfterMove(sizes: readonly number[], from: number, to: number): number[] {
  return sizes.map((size, index) => size - (index === from ? 1 : 0) + (index === to ? 1 : 0));
}

export interface PlannedPoolGame {
  /** From 1, the round the pool plays it in. */
  round: number;
  /** From 1, within the round. */
  slot: number;
  /** Places in the pool's seed order, from 1. */
  entrants: readonly [number, number];
}

/** The circle method: one place stays and the rest turn, so a team plays once a round and an odd pool rests one team each round. */
export function planPoolGames(teamCount: number): PlannedPoolGame[] {
  const places: (number | null)[] = Array.from({ length: teamCount }, (_, index) => index + 1);
  if (teamCount % 2 === 1) places.push(null);
  const size = places.length;
  const games: PlannedPoolGame[] = [];
  for (let round = 1; round < size; round++) {
    let slot = 0;
    for (let index = 0; index < size / 2; index++) {
      const home = places[index]!;
      const away = places[size - 1 - index];
      if (away === null || away === undefined || home === null) continue;
      slot++;
      games.push({ round, slot, entrants: [home, away] });
    }
    places.splice(1, 0, places.pop()!);
  }
  return games;
}

export function gamesMatchPools(
  pools: ReadonlyMap<Pool, readonly string[]>,
  games: readonly { pool: Pool; teamIds: readonly (string | null)[] }[],
): boolean {
  const gamePools = new Set(games.map((game) => game.pool));
  if ([...gamePools].some((pool) => !pools.has(pool))) return false;
  for (const [pool, teamIds] of pools) {
    const members = new Set(teamIds);
    const played = games.filter((game) => game.pool === pool);
    const pairs = new Set<string>();
    for (const game of played) {
      const [one, other] = game.teamIds;
      if (!one || !other || one === other || !members.has(one) || !members.has(other)) {
        return false;
      }
      pairs.add([one, other].sort().join('|'));
    }
    if (pairs.size !== played.length || pairs.size !== (members.size * (members.size - 1)) / 2) {
      return false;
    }
  }
  return true;
}
