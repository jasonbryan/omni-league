import {
  registrationIsOpen,
  seasonPhase,
  type SeasonDates,
} from '../../../convex/lib/registration';
import type { HlmBadgeVariant } from '../ui/badge';
import { seasonDates } from './league/season-dates';
import type { PublicOpenTournamentRows } from './organization-path';
import { BADGE_TEXT, closesText, compare } from './season-status';

export const OPEN_TOURNAMENTS_INTRO = 'Register a team for a tournament.';

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

export function tournamentStatus(tournament: SeasonDates, nowMs: number): TournamentStatusLine {
  const phase = seasonPhase(tournament, nowMs);
  const registrationOpen = phase === 'registrationOpen';
  const dates = seasonDates(tournament.startDate, tournament.endDate);
  return {
    badge: BADGE_TEXT[phase],
    badgeVariant: registrationOpen ? 'secondary' : 'muted',
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
