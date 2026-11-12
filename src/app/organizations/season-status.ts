import {
  registrationIsOpen,
  seasonPhase,
  type SeasonDates,
  type SeasonPhase,
} from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
import type { HlmBadgeVariant } from '../ui/badge';
import type { PublicOpenSeasonRows } from './organization-path';

export interface LeagueRowSeason extends SeasonDates {
  name: string;
  slug: string;
  isFull?: boolean | undefined;
}

export interface SeasonStatusLine {
  badge: string | null;
  badgeVariant: HlmBadgeVariant | null;
  registrationOpen: boolean;
  text: string;
  season: { name: string; slug: string } | null;
}

export const FULL_BADGE_TEXT = 'Full';

export const OPEN_SEASONS_INTRO =
  'Register a team, or register as a free agent and an organizer places you on one.';

export const BADGE_TEXT: Record<SeasonPhase, string> = {
  registrationOpen: 'Registration open',
  registrationClosed: 'Registration closed',
  inProgress: 'In progress',
  ended: 'Ended',
};

export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Full only while registration is open: once it closes, the waitlist takes no entries and the phase says more. */
export function isOpenAndFull(
  phase: SeasonPhase,
  season: { isFull?: boolean | undefined },
): boolean {
  return phase === 'registrationOpen' && season.isFull === true;
}

/** "May 19" from a stored calendar date, read as text so the server and a browser in any time zone agree. */
export function closesText(registrationDeadline: string): string {
  return formatCalendarDate(registrationDeadline).replace(/, \d+$/, '');
}

export function soonestClosingOpenSeason<
  T extends Pick<LeagueRowSeason, 'slug' | 'startDate' | 'registrationDeadline'>,
>(seasons: readonly T[] | undefined, nowMs: number): T | undefined {
  return (seasons ?? [])
    .filter((season) => registrationIsOpen(season, nowMs))
    .sort(
      (a, b) =>
        compare(a.registrationDeadline, b.registrationDeadline) ||
        compare(a.startDate, b.startDate) ||
        compare(a.slug, b.slug),
    )[0];
}

export function nextSeason(
  seasons: readonly LeagueRowSeason[],
  nowMs: number,
): LeagueRowSeason | undefined {
  let next: LeagueRowSeason | undefined;
  for (const season of seasons) {
    if (seasonPhase(season, nowMs) === 'ended') continue;
    if (next === undefined || season.startDate < next.startDate) next = season;
  }
  return next;
}

/** Undefined for a row from a saved copy made before rows held their seasons: it cannot say there is none. */
export function leagueSeasonStatus(
  seasons: readonly LeagueRowSeason[] | undefined,
  nowMs: number,
): SeasonStatusLine | undefined {
  if (seasons === undefined) return undefined;
  const next = soonestClosingOpenSeason(seasons, nowMs) ?? nextSeason(seasons, nowMs);
  if (next === undefined) {
    return {
      badge: null,
      badgeVariant: null,
      registrationOpen: false,
      text: 'No upcoming season',
      season: null,
    };
  }
  const phase = seasonPhase(next, nowMs);
  const season = { name: next.name, slug: next.slug };
  if (isOpenAndFull(phase, next)) {
    const text = `${next.name} · waitlist open`;
    return {
      badge: FULL_BADGE_TEXT,
      badgeVariant: 'outline',
      registrationOpen: true,
      text,
      season,
    };
  }
  const registrationOpen = phase === 'registrationOpen';
  return {
    badge: BADGE_TEXT[phase],
    badgeVariant: registrationOpen ? 'secondary' : 'muted',
    registrationOpen,
    text: registrationOpen
      ? `${next.name} · closes ${closesText(next.registrationDeadline)}`
      : next.name,
    season,
  };
}

export function openSeasonsBySoonestDeadline(
  seasons: PublicOpenSeasonRows,
  nowMs: number,
): PublicOpenSeasonRows {
  return seasons
    .filter((season) => registrationIsOpen(season, nowMs))
    .sort(
      (a, b) =>
        compare(a.registrationDeadline, b.registrationDeadline) ||
        compare(a.league.name, b.league.name) ||
        compare(a.name, b.name),
    );
}
