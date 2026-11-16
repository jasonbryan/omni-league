import {
  registrationIsOpen,
  seasonPhase,
  dateAtUtcMinus12,
} from '../../../convex/lib/registration';
import type { HlmBadgeVariant } from '../ui/badge';
import { seasonDates } from './league/season-dates';
import type { PublicCampRows, PublicOpenCampRows } from './organization-path';
import { BADGE_TEXT, closesText, compare, FULL_BADGE_TEXT } from './season-status';

type CampSession = PublicCampRows[number]['sessions'][number];

export interface CampStatusLine {
  badge: string;
  badgeVariant: HlmBadgeVariant;
  registrationOpen: boolean;
  text: string;
}

/** The query keeps the camps whose last session had not ended when it ran; the page drops one that has ended since. */
export function upcomingCamps<
  T extends { lastSessionEndDate: string; sessions: readonly unknown[] },
>(camps: readonly T[], nowMs: number): T[] {
  const today = dateAtUtcMinus12(nowMs);
  return camps.filter((camp) => camp.lastSessionEndDate >= today && camp.sessions.length > 0);
}

/** The sessions come in start order, so the first that has not ended is the earliest to come. */
export function nextCampSession(
  sessions: readonly CampSession[],
  nowMs: number,
): CampSession | undefined {
  const today = dateAtUtcMinus12(nowMs);
  return sessions.find((session) => session.endDate >= today) ?? sessions.at(-1);
}

/** The row shows the earliest session open for registration with room, so a full or closed next session does not hide the Register link of a later one; with none open it shows the next. */
export function shownCampSession(
  sessions: readonly CampSession[],
  nowMs: number,
): CampSession | undefined {
  return (
    sessions.find((session) => registrationIsOpen(session, nowMs) && session.placesLeft > 0) ??
    nextCampSession(sessions, nowMs)
  );
}

/** The status of the camp's session, as a season's: its places only add Full once registration is open. */
export function campStatus(next: CampSession, nowMs: number): CampStatusLine {
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
