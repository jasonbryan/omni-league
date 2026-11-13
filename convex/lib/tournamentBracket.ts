// The only writer of `tournamentGames` and `teams.seed`.
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { inSeedOrder, isConfirmedTeam, planBracket, type BracketRefusal } from './bracket';
import { MAX_MAXIMUM_TEAMS } from './tournamentInput';

type ReadCtx = Pick<QueryCtx, 'db'>;

const STAGE = 'bracket';

// A bracket of the most teams a tournament takes has one game fewer than teams.
const BRACKET_GAMES_READ_LIMIT = MAX_MAXIMUM_TEAMS;

export function refuseBracket(refusal: BracketRefusal, extra: object = {}): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal, ...extra });
}

export function bracketGames(
  ctx: ReadCtx,
  tournamentId: Id<'tournaments'>,
): Promise<Doc<'tournamentGames'>[]> {
  return ctx.db
    .query('tournamentGames')
    .withIndex('by_tournamentId_and_stage_and_round_and_slot', (q) =>
      q.eq('tournamentId', tournamentId).eq('stage', STAGE),
    )
    .take(BRACKET_GAMES_READ_LIMIT);
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

/** A bye has a winner from the start, but only one team; a result is a winner between two. */
export function gameHasResult(game: Doc<'tournamentGames'>): boolean {
  return game.winnerTeamId !== undefined && game.teamIds.every((teamId) => teamId !== null);
}

export function bracketHasResult(games: readonly Doc<'tournamentGames'>[]): boolean {
  return games.some(gameHasResult);
}

export interface TournamentTeams {
  seeds: Doc<'teams'>[];
  unconfirmedCount: number;
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
    unconfirmedCount: teams.length - confirmed.length,
  };
}

export async function saveSeeds(ctx: MutationCtx, seeds: readonly Doc<'teams'>[]): Promise<void> {
  for (const [index, team] of seeds.entries()) {
    if (team.seed !== index + 1) await ctx.db.patch('teams', team._id, { seed: index + 1 });
  }
}

export async function replaceBracket(
  ctx: MutationCtx,
  tournamentId: Id<'tournaments'>,
  seeds: readonly Doc<'teams'>[],
  replaced: readonly Doc<'tournamentGames'>[],
): Promise<number> {
  for (const game of replaced) await ctx.db.delete('tournamentGames', game._id);
  await saveSeeds(ctx, seeds);
  const teamOf = (seed: number | null): Id<'teams'> | null =>
    seed === null ? null : seeds[seed - 1]._id;
  const ids = new Map<string, Id<'tournamentGames'>>();
  const plan = planBracket(seeds.length);
  // The Final first, so each game knows the id of the one its winner joins.
  for (const game of [...plan].reverse()) {
    const next = game.next;
    const nextGameId = next && ids.get(`${game.round + 1}.${next.slot}`);
    const winnerTeamId = teamOf(game.advances);
    const id = await ctx.db.insert('tournamentGames', {
      tournamentId,
      stage: STAGE,
      round: game.round,
      slot: game.slot,
      teamIds: game.entrants.map(teamOf),
      ...(winnerTeamId && { winnerTeamId }),
      ...(next && nextGameId && { nextGameId, nextSide: next.side }),
    });
    ids.set(`${game.round}.${game.slot}`, id);
  }
  return plan.length;
}
