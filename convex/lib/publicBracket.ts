import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { seedOrderOfBracket } from './bracket';
import { playoffRoundName } from './doubleBracket';
import type { PublicBracket } from './publicPage';
import {
  allPlayoffGames,
  championOf,
  gameHasResult,
  playoffGames,
  playoffRoundsOf,
} from './tournamentBracket';
import { playsDecidingGame } from './tournamentEdit';

type Game = Doc<'tournamentGames'>;
type PublicGame = PublicBracket['rounds'][number]['games'][number];
type Place = PublicGame['teams'][number];

export async function publicBracket(
  ctx: Pick<QueryCtx, 'db'>,
  tournament: Doc<'tournaments'>,
): Promise<PublicBracket | undefined> {
  const playoff = await playoffGames(ctx, tournament._id);
  if (playoff.winners.length === 0) return undefined;
  const teams = await teamsOf(ctx, allPlayoffGames(playoff));
  const seedOf = new Map(
    seedOrderOfBracket(playoff.winners).map((teamId, index) => [teamId, index + 1]),
  );
  const rounds = playoffRoundsOf(playoff);
  const placeOf = (teamId: Id<'teams'> | null): Place => {
    const team = teamId && teams.get(teamId);
    if (!team) return null;
    const seed = seedOf.get(team._id);
    return { name: team.name, ...(seed !== undefined && { seed }) };
  };
  const gameOf = (game: Game): PublicGame => {
    const winnerPlace = gameHasResult(game) ? game.teamIds.indexOf(game.winnerTeamId!) : -1;
    return {
      teams: game.teamIds.map(placeOf),
      bye: game.round === 1 && game.stage === 'bracket' && game.teamIds.includes(null),
      ...(winnerPlace === 0 || winnerPlace === 1 ? { winner: winnerPlace } : {}),
      ...resultOf(game),
    };
  };
  const roundsOf = (stage: 'bracket' | 'losers', games: readonly Game[], total: number) =>
    Array.from({ length: total }, (_, index) => ({
      name: playoffRoundName({ stage, round: index + 1 }, rounds),
      games: games.filter((game) => game.round === index + 1).map(gameOf),
    })).filter((round) => round.games.length > 0);

  const winner = placeOf(championOf(playoff) ?? null);
  const losers = roundsOf('losers', playoff.losers, rounds.losers);
  return {
    ...(winner && { winner: winner.name }),
    rounds: roundsOf('bracket', playoff.winners, rounds.winners),
    ...(losers.length > 0 && { losers }),
    ...(rounds.double && {
      grandFinal: {
        games: playoff.grandFinal.map(gameOf),
        decidingGameIfNeeded: playsDecidingGame(tournament),
      },
    }),
  };
}

type Result = Pick<PublicGame, 'score' | 'forfeit'>;

/** A forfeit is a side and never its stored score, which the page would otherwise show as a played game. */
function resultOf(game: Game): Result {
  if (!gameHasResult(game)) return {};
  if (game.forfeitTeamId !== undefined) {
    const side = game.teamIds.indexOf(game.forfeitTeamId);
    return side === 0 || side === 1 ? { forfeit: side } : {};
  }
  return game.score ? { score: game.score } : {};
}

async function teamsOf(
  ctx: Pick<QueryCtx, 'db'>,
  games: readonly Game[],
): Promise<Map<Id<'teams'>, Doc<'teams'>>> {
  const ids = new Set(games.flatMap((game) => game.teamIds).filter((id) => id !== null));
  const teams = await Promise.all([...ids].map((id) => ctx.db.get('teams', id)));
  return new Map(teams.filter((team) => team !== null).map((team) => [team._id, team]));
}
