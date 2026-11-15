import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { inSeedOrder } from './bracket';
import { poolIndexOf } from './pools';
import type { PublicPool } from './publicPage';
import type { Sport } from './sports';
import {
  STANDINGS_TIEBREAKER_NOTES,
  standingsCells,
  standingsColumns,
  standingsOf,
} from './standings';
import { gameHasResult } from './tournamentBracket';
import { poolGames } from './tournamentPools';

type Game = Doc<'tournamentGames'>;
type PublicGame = PublicPool['games'][number];

export async function publicPools(
  ctx: Pick<QueryCtx, 'db'>,
  tournament: Doc<'tournaments'>,
  sport: Sport,
): Promise<PublicPool[] | undefined> {
  const games = await poolGames(ctx, tournament._id);
  if (games.length === 0) return undefined;
  const teams = await teamsOf(ctx, games);
  const nameOf = (teamId: Id<'teams'> | null) =>
    (teamId ? teams.get(teamId)?.name : undefined) ?? '';
  const pools = [...new Set(games.flatMap((game) => (game.pool ? [game.pool] : [])))].sort(
    (a, b) => poolIndexOf(a) - poolIndexOf(b),
  );
  return pools.map((pool) => {
    const poolGamesOf = games.filter((game) => game.pool === pool);
    const teamIds = inSeedOrder(
      [...new Set(poolGamesOf.flatMap((game) => game.teamIds))].flatMap((teamId) => {
        const team = teamId && teams.get(teamId);
        return team ? [team] : [];
      }),
    ).map((team) => team._id);
    const standings = standingsOf(
      sport,
      teamIds,
      poolGamesOf.flatMap((game) => {
        const [first, second] = game.teamIds;
        return gameHasResult(game) && game.score && first && second
          ? [{ teamIds: [first, second] as const, score: game.score }]
          : [];
      }),
    );
    return {
      pool,
      columns: standingsColumns(sport),
      standings: standings.map((row) => ({
        place: row.place,
        name: nameOf(row.teamId as Id<'teams'>),
        cells: standingsCells(sport, row),
      })),
      tiebreakers: STANDINGS_TIEBREAKER_NOTES[sport],
      games: poolGamesOf.map((game) => gameView(game, nameOf)),
    };
  });
}

function gameView(game: Game, nameOf: (teamId: Id<'teams'> | null) => string): PublicGame {
  const base = { round: game.round, teams: game.teamIds.map(nameOf) };
  if (!gameHasResult(game)) return base;
  if (game.forfeitTeamId !== undefined) {
    const side = game.teamIds.indexOf(game.forfeitTeamId);
    return { ...base, ...(side === 0 || side === 1 ? { forfeit: side } : {}), ...winnerOf(game) };
  }
  return { ...base, ...(game.score && { score: game.score }), ...winnerOf(game) };
}

/** A forfeit is a side and never its stored score, which the page would otherwise show as a played game. */
function winnerOf(game: Game): Pick<PublicGame, 'winner'> {
  const side = game.winnerTeamId === undefined ? -1 : game.teamIds.indexOf(game.winnerTeamId);
  return side === 0 || side === 1 ? { winner: side } : {};
}

async function teamsOf(
  ctx: Pick<QueryCtx, 'db'>,
  games: readonly Game[],
): Promise<Map<Id<'teams'>, Doc<'teams'>>> {
  const ids = new Set(games.flatMap((game) => game.teamIds).filter((id) => id !== null));
  const teams = await Promise.all([...ids].map((id) => ctx.db.get('teams', id)));
  return new Map(teams.filter((team) => team !== null).map((team) => [team._id, team]));
}
