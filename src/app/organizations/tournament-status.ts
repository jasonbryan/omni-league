import {
  registrationIsOpen,
  seasonPhase,
  type SeasonDates,
} from '../../../convex/lib/registration';
import type { HlmBadgeVariant } from '../ui/badge';
import { seasonDates } from './league/season-dates';
import type { PublicOpenTournamentRows } from './organization-path';
import { BADGE_TEXT, closesText, compare, FULL_BADGE_TEXT, isOpenAndFull } from './season-status';

export const OPEN_TOURNAMENTS_INTRO = 'Register a team for a tournament.';

// Tournaments take teams only, so a season's free agent line stays off whenever a tournament is among the cards.
export const OPEN_MIXED_INTRO = 'Register a team for a season or a tournament.';

export const REGISTER_FOR_SEASON = 'Register for a season';
export const REGISTER_FOR_TOURNAMENT = 'Register for a tournament';

export interface TournamentStatusLine {
  badge: string;
  badgeVariant: HlmBadgeVariant;
  registrationOpen: boolean;
  text: string;
}

/** The query keeps the tournaments that had not ended when it ran; the page drops one that has ended since. */
export function upcomingTournaments<T extends SeasonDates>(
  tournaments: readonly T[],
  nowMs: number,
): T[] {
  return tournaments.filter((tournament) => seasonPhase(tournament, nowMs) !== 'ended');
}

/** A full tournament has no waitlist, so while registration is open it reads Full and offers no Register link. */
export function tournamentStatus(
  tournament: SeasonDates & { isFull?: boolean | undefined },
  nowMs: number,
): TournamentStatusLine {
  const phase = seasonPhase(tournament, nowMs);
  const full = isOpenAndFull(phase, tournament);
  const registrationOpen = phase === 'registrationOpen' && !full;
  const dates = seasonDates(tournament.startDate, tournament.endDate);
  return {
    badge: full ? FULL_BADGE_TEXT : BADGE_TEXT[phase],
    badgeVariant: registrationOpen ? 'secondary' : full ? 'outline' : 'muted',
    registrationOpen,
    text: registrationOpen
      ? `${dates} · closes ${closesText(tournament.registrationDeadline)}`
      : dates,
  };
}

export function openTournamentsBySoonestDeadline(
  tournaments: PublicOpenTournamentRows,
  nowMs: number,
): PublicOpenTournamentRows {
  return tournaments
    .filter((tournament) => registrationIsOpen(tournament, nowMs))
    .sort(
      (a, b) => compare(a.registrationDeadline, b.registrationDeadline) || compare(a.name, b.name),
    );
}
