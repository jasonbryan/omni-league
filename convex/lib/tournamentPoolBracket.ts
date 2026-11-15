import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { POOL_MESSAGES } from './pools';
import { seedsFromPools, type PoolSeed, type PoolStanding } from './poolBracket';
import type { Sport } from './sports';
import { gameHasResult, replaceBracket } from './tournamentBracket';
import { poolGames, poolSetup, refusePool } from './tournamentPools';

export interface PoolResults {
  gameCount: number;
  withoutResult: number;
  poolSizes: number[];
  ranked: (PoolSeed & { team: Doc<'teams'> })[];
  unassigned: Doc<'teams'>[];
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
    unassigned: setup.unassigned,
  };
}

function chosenOrder(
  advancing: readonly Doc<'teams'>[],
  order: readonly Id<'teams'>[],
): Doc<'teams'>[] {
  const byId = new Map(advancing.map((team) => [team._id, team]));
  const chosen = order.flatMap((teamId) => byId.get(teamId) ?? []);
  const sameTeams =
    order.length === advancing.length &&
    chosen.length === advancing.length &&
    new Set(order).size === order.length;
  if (!sameTeams) refusePool({ code: 'seedsChanged', message: POOL_MESSAGES.seedsChanged });
  return chosen;
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
  const seeds = seedOrder ? chosenOrder(advancing, seedOrder) : advancing;
  const others = [
    ...results.ranked.slice(advancingCount).map((seed) => seed.team),
    ...results.unassigned,
  ];
  const gameCount = await replaceBracket(ctx, tournament._id, seeds, replaced, others);
  return { gameCount, teamCount: seeds.length };
}
