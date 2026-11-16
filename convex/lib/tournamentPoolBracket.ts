import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { POOL_MESSAGES } from './pools';
import { checkAdvancing, seedsFromPools, type PoolSeed, type PoolStanding } from './poolBracket';
import type { Sport } from './sports';
import { gameHasResult, replaceBracketGames } from './tournamentBracket';
import { poolGames, poolSetup, refusePool } from './tournamentPools';

export interface PoolResults {
  gameCount: number;
  withoutResult: number;
  poolSizes: number[];
  ranked: (PoolSeed & { team: Doc<'teams'> })[];
}

export async function poolResults(
  ctx: Pick<QueryCtx, 'db'>,
  tournament: Doc<'tournaments'>,
  sport: Sport,
): Promise<PoolResults> {
  const setup = await poolSetup(ctx, tournament);
  const games = await poolGames(ctx, tournament._id);
  const standings: PoolStanding[] = [...setup.pools].map(([pool, teams]) => ({
    pool,
    teamIds: teams.map((team) => team._id),
    games: games.flatMap((game) => {
      const [first, second] = game.teamIds;
      return game.pool === pool && gameHasResult(game) && game.score && first && second
        ? [{ teamIds: [first, second] as const, score: game.score }]
        : [];
    }),
  }));
  const teamOf = new Map<string, Doc<'teams'>>(setup.seeds.map((team) => [team._id, team]));
  return {
    gameCount: games.length,
    withoutResult: games.filter((game) => !gameHasResult(game)).length,
    poolSizes: [...setup.pools.values()].map((teams) => teams.length),
    ranked: seedsFromPools(sport, standings).map((seed) => ({
      ...seed,
      team: teamOf.get(seed.teamId)!,
    })),
  };
}

function chosenOrder(
  results: PoolResults,
  advancePerPool: number,
  order: readonly Id<'teams'>[],
): Doc<'teams'>[] {
  const ranked = new Map(results.ranked.map((seed) => [seed.team._id, seed]));
  const chosen = order.flatMap((teamId) => ranked.get(teamId) ?? []);
  const issue =
    chosen.length === order.length
      ? checkAdvancing(
          chosen,
          [...new Set(results.ranked.map((seed) => seed.pool))],
          advancePerPool,
        )
      : {
          code: 'advancingInvalid' as const,
          message: POOL_MESSAGES.advancingInvalid(advancePerPool),
        };
  if (issue) refusePool(issue);
  return chosen.map((seed) => seed.team);
}

export async function replaceBracketFromPools(
  ctx: MutationCtx,
  tournament: Doc<'tournaments'>,
  results: PoolResults,
  advancePerPool: number,
  replaced: readonly Doc<'tournamentGames'>[],
  seedOrder?: readonly Id<'teams'>[],
): Promise<{ gameCount: number; teamCount: number }> {
  const advancingCount = advancePerPool * results.poolSizes.length;
  const advancing = results.ranked.slice(0, advancingCount).map((seed) => seed.team);
  const seeds = seedOrder ? chosenOrder(results, advancePerPool, seedOrder) : advancing;
  // `teams.seed` stays the split's order, which the pool tables keep for teams that nothing separates.
  const gameCount = await replaceBracketGames(ctx, tournament._id, seeds, replaced);
  return { gameCount, teamCount: seeds.length };
}
