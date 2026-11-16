import { OPEN_SEASONS_INTRO } from './season-status';
import {
  OPEN_MIXED_INTRO,
  OPEN_TOURNAMENTS_INTRO,
  REGISTER_FOR_SEASON,
  REGISTER_FOR_TOURNAMENT,
} from './tournament-status';

export type OpenCardKind = 'season' | 'tournament' | 'camp';

export const OPEN_CAMPS_INTRO = 'Register yourself or a child for a camp session.';

export const REGISTER_FOR_CAMP = 'Register for a camp';

const REGISTER_FOR: Record<OpenCardKind, string> = {
  season: REGISTER_FOR_SEASON,
  tournament: REGISTER_FOR_TOURNAMENT,
  camp: REGISTER_FOR_CAMP,
};

export function registerForText(kind: OpenCardKind): string {
  return REGISTER_FOR[kind];
}

export function leadingKind(kinds: readonly OpenCardKind[]): OpenCardKind {
  return (
    (['season', 'tournament', 'camp'] as const).find((kind) => kinds.includes(kind)) ?? 'season'
  );
}

/** Camp sessions take a person, so the team line of seasons and tournaments gives way to a line for each. */
export function openIntro(kinds: readonly OpenCardKind[]): string {
  const season = kinds.includes('season');
  const tournament = kinds.includes('tournament');
  const camp = kinds.includes('camp');
  if (!camp) {
    if (season && tournament) return OPEN_MIXED_INTRO;
    return tournament ? OPEN_TOURNAMENTS_INTRO : OPEN_SEASONS_INTRO;
  }
  if (!season && !tournament) return OPEN_CAMPS_INTRO;
  const teams =
    season && tournament ? 'a season or a tournament' : season ? 'a season' : 'a tournament';
  return `Register a team for ${teams}, or yourself or a child for a camp session.`;
}
