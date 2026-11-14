import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { scoreValidator } from './sports';
import { reportsOfGame } from './tournamentBracket';

export const reportViewValidator = v.object({
  reportId: v.id('scoreReports'),
  teamId: v.id('teams'),
  teamName: v.string(),
  score: scoreValidator,
  reportedAt: v.number(),
});

export function currentGameOf(
  games: readonly Doc<'tournamentGames'>[],
  teamId: Id<'teams'>,
): Doc<'tournamentGames'> | null {
  const open = games
    .filter((game) => game.teamIds.includes(teamId))
    .sort((a, b) => a.round - b.round)
    .find((game) => game.winnerTeamId === undefined);
  return open?.teamIds.every((placed) => placed !== null) ? open : null;
}

export async function reportsInPlaceOrder(
  ctx: Pick<QueryCtx, 'db'>,
  game: Doc<'tournamentGames'>,
): Promise<Doc<'scoreReports'>[]> {
  const reports = await reportsOfGame(ctx, game._id);
  return game.teamIds.flatMap((teamId) => reports.filter((report) => report.teamId === teamId));
}
