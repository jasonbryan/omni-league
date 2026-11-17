import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { scoreValidator } from './sports';
import {
  allPlayoffGames,
  gameHasResult,
  gameIsDecided,
  playoffGames,
  reportsOfGame,
} from './tournamentBracket';
import { poolGames } from './tournamentPools';

export const reportViewValidator = v.object({
  reportId: v.id('scoreReports'),
  teamId: v.id('teams'),
  teamName: v.string(),
  score: scoreValidator,
  reportedAt: v.number(),
});

const byRoundAndSlot = (a: Doc<'tournamentGames'>, b: Doc<'tournamentGames'>) =>
  a.round - b.round || a.slot - b.slot;

export function reportableGamesOf(
  games: readonly Doc<'tournamentGames'>[],
  teamId: Id<'teams'>,
): Doc<'tournamentGames'>[] {
  const open = games
    .filter((game) => game.teamIds.includes(teamId) && !gameIsDecided(game))
    .sort(byRoundAndSlot);
  const [bracket] = open.filter((game) => game.stage !== 'pool');
  const current = bracket?.teamIds.every((placed) => placed !== null) ? [bracket] : [];
  return [...open.filter((game) => game.stage === 'pool'), ...current];
}

export async function reportableGamesOfTeam(
  ctx: Pick<QueryCtx, 'db'>,
  tournamentId: Id<'tournaments'>,
  teamId: Id<'teams'>,
): Promise<Doc<'tournamentGames'>[]> {
  const games = [
    ...(await poolGames(ctx, tournamentId)),
    ...allPlayoffGames(await playoffGames(ctx, tournamentId)),
  ];
  return reportableGamesOf(games, teamId);
}

export async function reportsInPlaceOrder(
  ctx: Pick<QueryCtx, 'db'>,
  game: Doc<'tournamentGames'>,
): Promise<Doc<'scoreReports'>[]> {
  const reports = await reportsOfGame(ctx, game._id);
  return game.teamIds.flatMap((teamId) => reports.filter((report) => report.teamId === teamId));
}

export async function reportViewsByGame(
  ctx: Pick<QueryCtx, 'db'>,
  games: readonly Doc<'tournamentGames'>[],
  teamNames: ReadonlyMap<Id<'teams'>, string>,
): Promise<Map<Id<'tournamentGames'>, Infer<typeof reportViewValidator>[]>> {
  const views = new Map<Id<'tournamentGames'>, Infer<typeof reportViewValidator>[]>();
  for (const game of games) {
    const open = !gameHasResult(game) && game.teamIds.every((teamId) => teamId !== null);
    const reports = open ? await reportsInPlaceOrder(ctx, game) : [];
    views.set(
      game._id,
      reports.map((reported) => ({
        reportId: reported._id,
        teamId: reported.teamId,
        teamName: teamNames.get(reported.teamId) ?? '',
        score: reported.score,
        reportedAt: reported.reportedAt,
      })),
    );
  }
  return views;
}
