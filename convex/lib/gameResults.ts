import { v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { requireGameOrganizer } from './access';
import { BRACKET_MESSAGES } from './bracket';
import { playoffRoundName } from './doubleBracket';
import { POOL_MESSAGES } from './pools';
import {
  POOL_PLAY_TIES,
  checkScore,
  forfeitScore,
  scoreValidator,
  scoreWinnerSide,
  type Score,
  type Sport,
} from './sports';
import { DEFAULT_SETS_PER_GAME } from './tournamentEdit';
import {
  allPlayoffGames,
  bracketExists,
  gameHasResult,
  nextGameOf,
  playoffGames,
  playoffRoundsOf,
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
  /** `null` for a tied pool game. */
  winnerTeamId: v.union(v.null(), v.id('teams')),
  winnerName: v.union(v.null(), v.string()),
  /** What Undo sends back, so it acts only on this result. */
  resultEnteredAt: v.number(),
  /** The round the winner joins; `null` for the Final, whose winner wins the tournament, and for a pool game. */
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

export const tiesAllowedIn = (game: Doc<'tournamentGames'>, sport: Sport) =>
  game.stage === 'pool' && POOL_PLAY_TIES[sport];

export type CheckedResult = StoredResult & { winnerTeamId?: Id<'teams'> | undefined };

export function refuseInvalidScore(
  tournament: Doc<'tournaments'>,
  sport: Sport,
  score: Score,
  allowTie = false,
): void {
  const issue = checkScore(sport, setsPerGameOf(tournament), score, { allowTie });
  if (issue)
    refuseBracket({ code: 'invalidScore', message: issue.message }, { field: issue.field });
}

export function checkedResult(
  game: Doc<'tournamentGames'>,
  tournament: Doc<'tournaments'>,
  sport: Sport,
  result: StoredResult,
): CheckedResult {
  refuseInvalidScore(tournament, sport, result.score, tiesAllowedIn(game, sport));
  const side = scoreWinnerSide(result.score);
  const winnerTeamId = side === null ? undefined : game.teamIds[side]!;
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
): CheckedResult {
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
  if (game.stage === 'pool' && (await bracketExists(ctx, game.tournamentId))) {
    refuseBracket({ code: 'poolsFrozen', message: POOL_MESSAGES.poolsFrozen });
  }
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
  const loserNext =
    game.loserNextGameId && (await ctx.db.get('tournamentGames', game.loserNextGameId));
  if (loserNext && gameHasResult(loserNext)) {
    refuseBracket({ code: 'loserGamePlayed', message: BRACKET_MESSAGES.loserGamePlayed });
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
  const { winnerTeamId } = result;
  return {
    winnerTeamId: winnerTeamId ?? null,
    winnerName: winnerTeamId ? ((await ctx.db.get('teams', winnerTeamId))?.name ?? '') : null,
    resultEnteredAt,
    advancesTo: await roundNameAfter(ctx, game, tournament),
    previous: hadResult ? previous : null,
  };
}

// Read after the save, because a first grand final game adds or removes its deciding game.
async function roundNameAfter(
  ctx: QueryCtx,
  game: Doc<'tournamentGames'>,
  tournament: Doc<'tournaments'>,
): Promise<string | null> {
  const { nextGameId } = (await ctx.db.get('tournamentGames', game._id))!;
  if (!nextGameId) return null;
  const playoff = await playoffGames(ctx, tournament._id);
  const next = allPlayoffGames(playoff).find((row) => row._id === nextGameId)!;
  return playoffRoundName(next, playoffRoundsOf(playoff));
}
