import type { PublicPool } from '../../../../convex/lib/publicPage';
import { scoreText, TIED_GAME_TEXT } from '../../../../convex/lib/sports';

type Game = PublicPool['games'][number];

export const NO_STANDINGS_YET = 'Standings appear after the first result.';

export function poolHasResult({ games }: Pick<PublicPool, 'games'>): boolean {
  return games.some((game) => game.score !== undefined || game.forfeit !== undefined);
}

/** The first team's score comes first, as the game lists its teams. */
export function poolGameResultText(game: Game): string | null {
  const forfeited = game.forfeit === undefined ? null : `${game.teams[game.forfeit]} forfeited.`;
  const outcome = game.winner === undefined ? null : `${game.teams[game.winner]} won.`;
  if (forfeited !== null) return outcome === null ? forfeited : `${forfeited} ${outcome}`;
  if (game.score === undefined) return null;
  return `${scoreText(game.score)}. ${outcome ?? TIED_GAME_TEXT}`;
}

export function columnKey({ columns }: Pick<PublicPool, 'columns'>): string {
  return `${columns.map(({ short, label }) => `${short} ${label.toLowerCase()}`).join(', ')}.`;
}
