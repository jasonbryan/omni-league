import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { requireGameOrganizer } from './access';
import { BRACKET_MESSAGES, roundName } from './bracket';
import {
  checkScore,
  forfeitScore,
  scoreValidator,
  scoreWinnerSide,
  type Score,
  type Sport,
} from './sports';
import { DEFAULT_SETS_PER_GAME } from './tournamentEdit';
import {
  bracketGames,
  gameHasResult,
  nextGameOf,
  refuseBracket,
  saveResult,
  storedResultOf,
  type StoredResult,
} from './tournamentBracket';

export const storedResultValidator = v.object({
  score: scoreValidator,
  forfeitTeamId: v.optional(v.id('teams')),
});

export const savedValidator = v.object({
  winnerTeamId: v.id('teams'),
  winnerName: v.string(),
  /** What Undo sends back, so it acts only on this result. */
  resultEnteredAt: v.number(),
  /** The round the winner joins; `null` for the Final, whose winner wins the tournament. */
  advancesTo: v.union(v.null(), v.string()),
  /** What the game held before, so the page can offer to restore it; `null` for a first result. */
  previous: v.union(v.null(), storedResultValidator),
});

export interface ResultInput {
  score?: Score | undefined;
  forfeitTeamId?: Id<'teams'> | undefined;
}

export const setsPerGameOf = (tournament: Doc<'tournaments'>) =>
  tournament.setsPerGame ?? DEFAULT_SETS_PER_GAME;

export function refuseInvalidScore(
  tournament: Doc<'tournaments'>,
  sport: Sport,
  score: Score,
): void {
  const issue = checkScore(sport, setsPerGameOf(tournament), score);
  if (issue)
    refuseBracket({ code: 'invalidScore', message: issue.message }, { field: issue.field });
}

export function checkedResult(
  game: Doc<'tournamentGames'>,
  tournament: Doc<'tournaments'>,
  sport: Sport,
  result: StoredResult,
): StoredResult & { winnerTeamId: Id<'teams'> } {
  refuseInvalidScore(tournament, sport, result.score);
  const winnerTeamId = game.teamIds[scoreWinnerSide(result.score)!]!;
  const { forfeitTeamId } = result;
  if (
    forfeitTeamId !== undefined &&
    (forfeitTeamId === winnerTeamId || !game.teamIds.includes(forfeitTeamId))
  ) {
    throw new Error('Not allowed');
  }
  return { ...result, winnerTeamId };
}

export function resultFrom(
  game: Doc<'tournamentGames'>,
  tournament: Doc<'tournaments'>,
  sport: Sport,
  { score, forfeitTeamId }: ResultInput,
): StoredResult & { winnerTeamId: Id<'teams'> } {
  // The page sends one or the other, so both or neither is a caller sending its own arguments.
  if ((score === undefined) === (forfeitTeamId === undefined)) throw new Error('Not allowed');
  if (forfeitTeamId === undefined) return checkedResult(game, tournament, sport, { score: score! });
  const side = game.teamIds.indexOf(forfeitTeamId);
  if (side !== 0 && side !== 1) throw new Error('Not allowed');
  return checkedResult(game, tournament, sport, {
    score: forfeitScore(sport, setsPerGameOf(tournament), side),
    forfeitTeamId,
  });
}

export async function refuseUnlessReady(
  ctx: QueryCtx,
  game: Doc<'tournamentGames'>,
  expectResult: boolean,
): Promise<void> {
  if (game.teamIds.some((teamId) => teamId === null)) {
    refuseBracket({ code: 'gameNotReady', message: BRACKET_MESSAGES.gameNotReady });
  }
  if (gameHasResult(game) !== expectResult) {
    refuseBracket(
      expectResult
        ? { code: 'noResult', message: BRACKET_MESSAGES.noResult }
        : { code: 'resultExists', message: BRACKET_MESSAGES.resultExists },
    );
  }
  const next = await nextGameOf(ctx, game);
  if (next && gameHasResult(next)) {
    refuseBracket({ code: 'nextGamePlayed', message: BRACKET_MESSAGES.nextGamePlayed });
  }
}

export async function saveFor(
  ctx: MutationCtx,
  { game, tournament, program, user }: Awaited<ReturnType<typeof requireGameOrganizer>>,
  input: ResultInput,
  hadResult: boolean,
) {
  await refuseUnlessReady(ctx, game, hadResult);
  const result = resultFrom(game, tournament, program.sport, input);
  const previous = storedResultOf(game);
  const resultEnteredAt = await saveResult(ctx, game, { ...result, enteredBy: user._id });
  const games = await bracketGames(ctx, tournament._id);
  const rounds = games.reduce((most, row) => Math.max(most, row.round), 0);
  return {
    winnerTeamId: result.winnerTeamId,
    winnerName: (await ctx.db.get('teams', result.winnerTeamId))?.name ?? '',
    resultEnteredAt,
    advancesTo: game.nextGameId ? roundName(game.round + 1, rounds) : null,
    previous: hadResult ? previous : null,
  };
}
