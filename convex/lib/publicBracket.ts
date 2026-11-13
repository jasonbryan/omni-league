import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { roundName } from './bracket';
import type { PublicBracket } from './publicPage';
import { bracketGames, gameHasResult } from './tournamentBracket';

type Game = Doc<'tournamentGames'>;
type Place = PublicBracket['rounds'][number]['games'][number]['teams'][number];

export async function publicBracket(
  ctx: Pick<QueryCtx, 'db'>,
  tournamentId: Id<'tournaments'>,
): Promise<PublicBracket | undefined> {
  const games = await bracketGames(ctx, tournamentId);
  if (games.length === 0) return undefined;
  const teams = await teamsOf(ctx, games);
  const placeOf = (teamId: Id<'teams'> | null): Place => {
    const team = teamId && teams.get(teamId);
    if (!team) return null;
    return { name: team.name, ...(team.seed !== undefined && { seed: team.seed }) };
  };
  const roundTotal = Math.max(...games.map((game) => game.round));
  const final = games.find((game) => game.round === roundTotal);
  const winner = final && gameHasResult(final) ? placeOf(final.winnerTeamId ?? null) : null;
  return {
    ...(winner && { winner: winner.name }),
    rounds: Array.from({ length: roundTotal }, (_, index) => ({
      name: roundName(index + 1, roundTotal),
      games: games
        .filter((game) => game.round === index + 1)
        .map((game) => {
          const winnerPlace = gameHasResult(game) ? game.teamIds.indexOf(game.winnerTeamId!) : -1;
          return {
            teams: game.teamIds.map(placeOf),
            bye: game.round === 1 && game.teamIds.includes(null),
            ...(winnerPlace === 0 || winnerPlace === 1 ? { winner: winnerPlace } : {}),
          };
        }),
    })),
  };
}

async function teamsOf(
  ctx: Pick<QueryCtx, 'db'>,
  games: readonly Game[],
): Promise<Map<Id<'teams'>, Doc<'teams'>>> {
  const ids = new Set(games.flatMap((game) => game.teamIds).filter((id) => id !== null));
  const teams = await Promise.all([...ids].map((id) => ctx.db.get('teams', id)));
  return new Map(teams.filter((team) => team !== null).map((team) => [team._id, team]));
}
