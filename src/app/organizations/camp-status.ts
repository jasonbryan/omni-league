import {
  registrationIsOpen,
  seasonPhase,
  dateAtUtcMinus12,
} from '../../../convex/lib/registration';
import type { HlmBadgeVariant } from '../ui/badge';
import { seasonDates } from './league/season-dates';
import type { PublicCampRows, PublicOpenCampRows } from './organization-path';
import { BADGE_TEXT, closesText, compare, FULL_BADGE_TEXT } from './season-status';

type NextSession = PublicCampRows[number]['nextSession'];

export interface CampStatusLine {
  badge: string;
  badgeVariant: HlmBadgeVariant;
  registrationOpen: boolean;
  text: string;
}

/** The query keeps the camps whose last session had not ended when it ran; the page drops one that has ended since. */
export function upcomingCamps<T extends { lastSessionEndDate: string }>(
  camps: readonly T[],
  nowMs: number,
): T[] {
  const today = dateAtUtcMinus12(nowMs);
  return camps.filter((camp) => camp.lastSessionEndDate >= today);
}

/** The status of the camp's next session, as a season's: its places only add Full once registration is open. */
export function campStatus(next: NextSession, nowMs: number): CampStatusLine {
  const phase = seasonPhase(next, nowMs);
  const full = phase === 'registrationOpen' && next.placesLeft === 0;
  const registrationOpen = phase === 'registrationOpen' && !full;
  const dates = seasonDates(next.startDate, next.endDate);
  return {
    badge: full ? FULL_BADGE_TEXT : BADGE_TEXT[phase],
    badgeVariant: registrationOpen ? 'secondary' : full ? 'outline' : 'muted',
    registrationOpen,
    text: registrationOpen ? `${dates} · closes ${closesText(next.registrationDeadline)}` : dates,
  };
}

export function openCampSessionsBySoonestDeadline(
  sessions: PublicOpenCampRows,
  nowMs: number,
): PublicOpenCampRows {
  return sessions
    .filter((session) => registrationIsOpen(session, nowMs))
    .sort(
      (a, b) =>
        compare(a.registrationDeadline, b.registrationDeadline) ||
        compare(a.name, b.name) ||
        compare(a.sessionName, b.sessionName),
    );
}
