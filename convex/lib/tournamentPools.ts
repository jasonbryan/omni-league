// With `tournamentBracket.ts`, the only writer of `tournamentGames`; the only writer of `teams.pool`.
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  MAX_POOL_GAMES,
  poolIndexOf,
  poolNameAt,
  planPoolGames,
  snakeSplit,
  type Pool,
  type PoolIssue,
} from './pools';
import {
  deleteReportsOfGame,
  gameHasResult,
  refuseBracket,
  tournamentTeams,
} from './tournamentBracket';

type ReadCtx = Pick<QueryCtx, 'db'>;

const STAGE = 'pool';

export function refusePool(issue: PoolIssue, extra: object = {}): never {
  refuseBracket(issue, extra);
}

export function poolGames(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
): Promise<Doc<'tournamentGames'>[]> {
  return ctx.db
    .query('tournamentGames')
    .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
      q.eq('tournamentId', tournamentId).eq('stage', STAGE),
    )
    .take(MAX_POOL_GAMES);
}

export function poolHasResult(games: readonly Doc<'tournamentGames'>[]): boolean {
  return games.some(gameHasResult);
}

export interface PoolSetup {
  /** Every confirmed team, in seed order. */
  seeds: Doc<'teams'>[];
  unconfirmed: Doc<'teams'>[];
  /** The confirmed teams of each pool, in seed order; a pool with no team is not in the map. */
  pools: Map<Pool, Doc<'teams'>[]>;
  /** The confirmed teams that no pool holds. */
  unassigned: Doc<'teams'>[];
}

export async function poolSetup(ctx: ReadCtx, tournament: Doc<'tournaments'>): Promise<PoolSetup> {
  const { seeds, unconfirmed } = await tournamentTeams(ctx, tournament);
  const pools = new Map<Pool, Doc<'teams'>[]>();
  const unassigned: Doc<'teams'>[] = [];
  for (const team of seeds) {
    if (team.pool === undefined) unassigned.push(team);
    else pools.set(team.pool, [...(pools.get(team.pool) ?? []), team]);
  }
  const ordered = new Map([...pools].sort(([a], [b]) => poolIndexOf(a) - poolIndexOf(b)));
  return { seeds, unconfirmed, pools: ordered, unassigned };
}

// Also clears the pool of a team that is no longer confirmed, so it does not return to a pool when it is confirmed again.
export async function assignPools(
  ctx: MutationCtx,
  setup: Pick<PoolSetup, 'seeds' | 'unconfirmed'>,
  poolCount: number,
): Promise<void> {
  const split = snakeSplit(setup.seeds.length, poolCount);
  for (const [index, seeds] of split.entries()) {
    for (const seed of seeds) {
      const team = setup.seeds[seed - 1];
      const pool = poolNameAt(index);
      if (team.pool !== pool) await ctx.db.patch('teams', team._id, { pool });
    }
  }
  for (const team of setup.unconfirmed) {
    if (team.pool !== undefined) await ctx.db.patch('teams', team._id, { pool: undefined });
  }
}

export async function moveToPool(ctx: MutationCtx, team: Doc<'teams'>, pool: Pool): Promise<void> {
  await ctx.db.patch('teams', team._id, { pool });
}

/** One round robin per pool, from the pools as they stand; the games they replace go with their score reports. */
export async function replacePoolGames(
  ctx: MutationCtx,
  tournamentId: Id<'tournaments'>,
  pools: ReadonlyMap<Pool, readonly Doc<'teams'>[]>,
  replaced: readonly Doc<'tournamentGames'>[],
): Promise<number> {
  for (const game of replaced) {
    await deleteReportsOfGame(ctx, game._id);
    await ctx.db.delete('tournamentGames', game._id);
  }
  let gameCount = 0;
  for (const [pool, teams] of pools) {
    for (const game of planPoolGames(teams.length)) {
      await ctx.db.insert('tournamentGames', {
        tournamentId,
        stage: STAGE,
        pool,
        round: game.round,
        slot: game.slot,
        teamIds: game.entrants.map((place) => teams[place - 1]._id),
      });
      gameCount++;
    }
  }
  return gameCount;
}
