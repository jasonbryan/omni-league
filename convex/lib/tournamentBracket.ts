// With `tournamentPools.ts`, the only writer of `tournamentGames`; the only writer of `teams.seed`.
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { inSeedOrder, isConfirmedTeam, type BracketRefusal, type BracketSide } from './bracket';
import {
  planPlayoff,
  type PlayoffGame,
  type PlayoffRounds,
  type PlayoffStage,
} from './doubleBracket';
import type { Score } from './sports';
import { playsDecidingGame } from './tournamentEdit';
import { MAX_MAXIMUM_TEAMS } from './tournamentInput';

type ReadCtx = Pick<QueryCtx, 'db'>;

const STAGE = 'bracket';

// A bracket of the most teams a tournament takes has one game fewer than teams, and a losers' bracket has two fewer.
const BRACKET_GAMES_READ_LIMIT = MAX_MAXIMUM_TEAMS;

/** A team reports once for its game, and a game has two teams. */
export const REPORTS_PER_GAME = 2;

export function refuseBracket(refusal: BracketRefusal, extra: object = {}): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal, ...extra });
}

function gamesOfStage(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
  stage: PlayoffStage,
): Promise<Doc<'tournamentGames'>[]> {
  return ctx.db
    .query('tournamentGames')
    .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
      q.eq('tournamentId', tournamentId).eq('stage', stage),
    )
    .take(BRACKET_GAMES_READ_LIMIT);
}

export function bracketGames(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
): Promise<Doc<'tournamentGames'>[]> {
  return gamesOfStage(ctx, tournamentId, STAGE);
}

/** A double-elimination bracket's games by stage; the losers' bracket and the grand final are empty for a single-elimination bracket. */
export interface PlayoffGames {
  winners: Doc<'tournamentGames'>[];
  losers: Doc<'tournamentGames'>[];
  grandFinal: Doc<'tournamentGames'>[];
}

export async function playoffGames(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
): Promise<PlayoffGames> {
  return {
    winners: await gamesOfStage(ctx, tournamentId, 'bracket'),
    losers: await gamesOfStage(ctx, tournamentId, 'losers'),
    grandFinal: await gamesOfStage(ctx, tournamentId, 'grandFinal'),
  };
}

export const allPlayoffGames = ({ winners, losers, grandFinal }: PlayoffGames) => [
  ...winners,
  ...losers,
  ...grandFinal,
];

const lastRound = (games: readonly Doc<'tournamentGames'>[]) =>
  games.reduce((most, game) => Math.max(most, game.round), 0);

export function playoffRoundsOf(playoff: PlayoffGames): PlayoffRounds {
  return {
    winners: lastRound(playoff.winners),
    losers: lastRound(playoff.losers),
    double: playoff.grandFinal.length > 0,
  };
}

export function championOf(playoff: PlayoffGames): Id<'teams'> | undefined {
  if (playoff.grandFinal.length === 0) {
    const rounds = lastRound(playoff.winners);
    const final = playoff.winners.find((game) => game.round === rounds);
    return final && gameHasResult(final) ? final.winnerTeamId : undefined;
  }
  const decider = playoff.grandFinal.reduce((last, game) =>
    game.round > last.round ? game : last,
  );
  return gameHasResult(decider) ? decider.winnerTeamId : undefined;
}

/** The stage of the tournament's first game: the index sorts by stage, so a bracket game comes before a pool game. */
export async function firstGameStage(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
): Promise<Doc<'tournamentGames'>['stage'] | null> {
  const first = await ctx.db
    .query('tournamentGames')
    .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
      q.eq('tournamentId', tournamentId),
    )
    .first();
  return first?.stage ?? null;
}

export async function bracketExists(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
): Promise<boolean> {
  const first = await ctx.db
    .query('tournamentGames')
    .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
      q.eq('tournamentId', tournamentId).eq('stage', STAGE),
    )
    .first();
  return first !== null;
}

/** True for a bye, which has a winner from the start, and for a tied pool game, which has a score and no winner. */
export function gameIsDecided(game: Doc<'tournamentGames'>): boolean {
  return game.winnerTeamId !== undefined || game.score !== undefined;
}

/** A bye has only one team; a result is a winner between two, or the score of a tied pool game. */
export function gameHasResult(game: Doc<'tournamentGames'>): boolean {
  return gameIsDecided(game) && game.teamIds.every((teamId) => teamId !== null);
}

export function bracketHasResult(games: readonly Doc<'tournamentGames'>[]): boolean {
  return games.some(gameHasResult);
}

export interface StoredResult {
  score: Score;
  forfeitTeamId?: Id<'teams'>;
}

export function storedResultOf(game: Doc<'tournamentGames'>): StoredResult | null {
  if (game.score === undefined) return null;
  return { score: game.score, ...(game.forfeitTeamId && { forfeitTeamId: game.forfeitTeamId }) };
}

export async function nextGameOf(
  ctx: ReadCtx,
  game: Doc<'tournamentGames'>,
): Promise<Doc<'tournamentGames'> | null> {
  return game.nextGameId ? ctx.db.get('tournamentGames', game.nextGameId) : null;
}

export function reportsOfGame(
  ctx: ReadCtx,
  gameId: Id<'tournamentGames'>,
): Promise<Doc<'scoreReports'>[]> {
  return ctx.db
    .query('scoreReports')
    .withIndex('by_gameId_and_teamId', (q) => q.eq('gameId', gameId))
    .take(REPORTS_PER_GAME);
}

export async function deleteReportsOfGame(
  ctx: MutationCtx,
  gameId: Id<'tournamentGames'>,
): Promise<void> {
  for (const report of await reportsOfGame(ctx, gameId)) {
    await ctx.db.delete('scoreReports', report._id);
  }
}

async function placeIn(
  ctx: MutationCtx,
  gameId: Id<'tournamentGames'> | undefined,
  side: BracketSide | undefined,
  teamId: Id<'teams'> | null,
): Promise<void> {
  const target = gameId && (await ctx.db.get('tournamentGames', gameId));
  if (!target || side === undefined) return;
  // A report names the score against the opponent the team had, so another team or an emptied place voids it, and an Undo of the feeder's Clear does not bring it back.
  if (target.teamIds.some((placed, index) => index === side && placed !== teamId)) {
    await deleteReportsOfGame(ctx, target._id);
  }
  await ctx.db.patch('tournamentGames', target._id, {
    teamIds: target.teamIds.map((placed, index) => (index === side ? teamId : placed)),
  });
}

async function syncDecidingGame(
  ctx: MutationCtx,
  first: Doc<'tournamentGames'>,
  winnerTeamId: Id<'teams'> | null,
): Promise<void> {
  if (first.round !== 1) return;
  const tournament = await ctx.db.get('tournaments', first.tournamentId);
  const needed =
    playsDecidingGame(tournament ?? {}) &&
    winnerTeamId !== null &&
    winnerTeamId === first.teamIds[1];
  const deciding = first.nextGameId && (await ctx.db.get('tournamentGames', first.nextGameId));
  if (needed && !deciding) {
    const nextGameId = await ctx.db.insert('tournamentGames', {
      tournamentId: first.tournamentId,
      stage: 'grandFinal',
      round: 2,
      slot: 1,
      teamIds: first.teamIds,
    });
    await ctx.db.patch('tournamentGames', first._id, { nextGameId });
  } else if (!needed && deciding) {
    await deleteReportsOfGame(ctx, deciding._id);
    await ctx.db.delete('tournamentGames', deciding._id);
    await ctx.db.patch('tournamentGames', first._id, { nextGameId: undefined });
  }
}

async function settle(
  ctx: MutationCtx,
  game: Doc<'tournamentGames'>,
  winnerTeamId: Id<'teams'> | null,
): Promise<void> {
  if (game.stage === 'grandFinal') return syncDecidingGame(ctx, game, winnerTeamId);
  await placeIn(ctx, game.nextGameId, game.nextSide, winnerTeamId);
  const loser =
    winnerTeamId === null ? null : (game.teamIds.find((id) => id !== winnerTeamId) ?? null);
  await placeIn(ctx, game.loserNextGameId, game.loserNextSide, loser);
}

export async function saveResult(
  ctx: MutationCtx,
  game: Doc<'tournamentGames'>,
  result: StoredResult & { winnerTeamId?: Id<'teams'> | undefined; enteredBy: Id<'users'> },
): Promise<number> {
  // Later than the result it replaces, even within one millisecond, so an Undo shown the earlier one is refused.
  const resultEnteredAt = Math.max(Date.now(), (game.resultEnteredAt ?? 0) + 1);
  await ctx.db.patch('tournamentGames', game._id, {
    winnerTeamId: result.winnerTeamId,
    score: result.score,
    forfeitTeamId: result.forfeitTeamId,
    resultEnteredAt,
    resultEnteredBy: result.enteredBy,
  });
  await settle(ctx, game, result.winnerTeamId ?? null);
  return resultEnteredAt;
}

export async function clearResult(ctx: MutationCtx, game: Doc<'tournamentGames'>): Promise<void> {
  await ctx.db.patch('tournamentGames', game._id, {
    winnerTeamId: undefined,
    score: undefined,
    forfeitTeamId: undefined,
    resultEnteredAt: undefined,
    resultEnteredBy: undefined,
  });
  await settle(ctx, game, null);
}

export interface TournamentTeams {
  seeds: Doc<'teams'>[];
  unconfirmed: Doc<'teams'>[];
}

export async function tournamentTeams(
  ctx: ReadCtx,
  tournament: Doc<'tournaments'>,
): Promise<TournamentTeams> {
  const teams = await ctx.db
    .query('teams')
    .withIndex('by_tournamentId_and_sortName', (q) => q.eq('tournamentId', tournament._id))
    .take(MAX_MAXIMUM_TEAMS);
  const confirmed = teams.filter((team) => isConfirmedTeam(team, tournament.minimumRosterSize));
  return {
    seeds: inSeedOrder(confirmed),
    unconfirmed: teams.filter((team) => !confirmed.includes(team)),
  };
}

export async function saveSeeds(ctx: MutationCtx, seeds: readonly Doc<'teams'>[]): Promise<void> {
  for (const [index, team] of seeds.entries()) {
    if (team.seed !== index + 1) await ctx.db.patch('teams', team._id, { seed: index + 1 });
  }
}

export async function replaceBracket(
  ctx: MutationCtx,
  tournament: Doc<'tournaments'>,
  seeds: readonly Doc<'teams'>[],
  replaced: readonly Doc<'tournamentGames'>[],
): Promise<number> {
  await saveSeeds(ctx, seeds);
  return replaceBracketGames(ctx, tournament, seeds, replaced);
}

/** The bracket's games for the seeds, leaving `teams.seed` as it is. */
export async function replaceBracketGames(
  ctx: MutationCtx,
  tournament: Doc<'tournaments'>,
  seeds: readonly Doc<'teams'>[],
  replaced: readonly Doc<'tournamentGames'>[],
): Promise<number> {
  for (const game of replaced) {
    await deleteReportsOfGame(ctx, game._id);
    await ctx.db.delete('tournamentGames', game._id);
  }
  const teamOf = (seed: number | null): Id<'teams'> | null =>
    seed === null ? null : seeds[seed - 1]._id;
  const ids = new Map<string, Id<'tournamentGames'>>();
  const keyOf = (game: Pick<PlayoffGame, 'stage' | 'round' | 'slot'>) =>
    `${game.stage}.${game.round}.${game.slot}`;
  const plan = planPlayoff(seeds.length, tournament.bracketType);
  // The last game first, so each game knows the ids of the ones its winner and loser join.
  for (const game of [...plan].reverse()) {
    const { winnerTo, loserTo } = game;
    const nextGameId = winnerTo && ids.get(keyOf(winnerTo));
    const loserNextGameId = loserTo && ids.get(keyOf(loserTo));
    const winnerTeamId = teamOf(game.advances);
    const id = await ctx.db.insert('tournamentGames', {
      tournamentId: tournament._id,
      stage: game.stage,
      round: game.round,
      slot: game.slot,
      teamIds: game.entrants.map(teamOf),
      ...(winnerTeamId && { winnerTeamId }),
      ...(winnerTo && nextGameId && { nextGameId, nextSide: winnerTo.side }),
      ...(loserTo && loserNextGameId && { loserNextGameId, loserNextSide: loserTo.side }),
    });
    ids.set(keyOf(game), id);
  }
  return plan.length;
}
