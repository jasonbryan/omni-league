import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { poolIndexOf } from './pools';
import { poolOrder } from './poolBracket';
import type { PublicPool } from './publicPage';
import type { Sport } from './sports';
import { STANDINGS_TIEBREAKER_NOTES, standingsCells, standingsColumns } from './standings';
import { gameHasResult } from './tournamentBracket';
import { poolStandings } from './tournamentPoolBracket';
import { poolGames, poolSetup } from './tournamentPools';

type Game = Doc<'tournamentGames'>;
type PublicGame = PublicPool['games'][number];

export async function publicPools(
  ctx: Pick<QueryCtx, 'db'>,
  tournament: Doc<'tournaments'>,
  sport: Sport,
): Promise<PublicPool[] | undefined> {
  const games = await poolGames(ctx, tournament._id);
  if (games.length === 0) return undefined;
  const setup = await poolSetup(ctx, tournament);
  const names = new Map<string, string>(
    [...setup.seeds, ...(await teamsOf(ctx, games)).values()].map((team) => [team._id, team.name]),
  );
  const nameOf = (teamId: string | null) => (teamId ? names.get(teamId) : undefined) ?? '';
  const standingOf = new Map(
    poolStandings(setup, games).map((standing) => [standing.pool, standing]),
  );
  const pools = [...new Set(games.flatMap((game) => (game.pool ? [game.pool] : [])))].sort(
    (a, b) => poolIndexOf(a) - poolIndexOf(b),
  );
  return pools.map((pool) => {
    const standing = standingOf.get(pool);
    return {
      pool,
      columns: standingsColumns(sport),
      standings: (standing ? poolOrder(sport, standing) : []).map(
        ({ teamId, place, tie, row }) => ({
          place: tie?.place ?? place,
          name: nameOf(teamId),
          cells: standingsCells(sport, row),
        }),
      ),
      tiebreakers: STANDINGS_TIEBREAKER_NOTES[sport],
      games: games.filter((game) => game.pool === pool).map((game) => gameView(game, nameOf)),
    };
  });
}

/** A forfeit is a side and never its stored score, which the page would otherwise show as a played game. */
function gameView(game: Game, nameOf: (teamId: Id<'teams'> | null) => string): PublicGame {
  const base = { round: game.round, teams: game.teamIds.map(nameOf) };
  if (!gameHasResult(game)) return base;
  if (game.forfeitTeamId !== undefined) {
    const side = game.teamIds.indexOf(game.forfeitTeamId);
    return { ...base, ...(side === 0 || side === 1 ? { forfeit: side } : {}), ...winnerOf(game) };
  }
  return { ...base, ...(game.score && { score: game.score }), ...winnerOf(game) };
}

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
