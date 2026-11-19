import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { playoffRoundName } from './doubleBracket';
import { scoreValidator } from './sports';
import {
  allPlayoffGames,
  gameHasResult,
  gameIsDecided,
  playoffGames,
  playoffRoundsOf,
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

export interface ReportableGameView {
  gameId: Id<'tournamentGames'>;
  stage: 'bracket' | 'pool';
  roundName: string;
  teams: { teamId: Id<'teams'>; name: string }[];
  report: { score: Doc<'scoreReports'>['score']; reportedAt: number } | null;
}

export async function reportableGameViewsOfTeam(
  ctx: Pick<QueryCtx, 'db'>,
  tournamentId: Id<'tournaments'>,
  teamId: Id<'teams'>,
): Promise<ReportableGameView[]> {
  const playoff = await playoffGames(ctx, tournamentId);
  const open = reportableGamesOf(
    [...(await poolGames(ctx, tournamentId)), ...allPlayoffGames(playoff)],
    teamId,
  );
  const rounds = playoffRoundsOf(playoff);
  const views: ReportableGameView[] = [];
  for (const game of open) {
    const reported = await ctx.db
      .query('scoreReports')
      .withIndex('by_gameId_and_teamId', (q) => q.eq('gameId', game._id).eq('teamId', teamId))
      .unique();
    const teams = [];
    for (const placed of game.teamIds) {
      const row = placed && (await ctx.db.get('teams', placed));
      if (row) teams.push({ teamId: row._id, name: row.name });
    }
    views.push({
      gameId: game._id,
      // The losers' bracket and the grand final are bracket games to a captain, as the previous frontend reads them.
      stage: game.stage === 'pool' ? 'pool' : 'bracket',
      roundName: playoffRoundName(game, rounds),
      teams,
      report: reported && { score: reported.score, reportedAt: reported.reportedAt },
    });
  }
  return views;
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
