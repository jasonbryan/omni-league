import {
  registrationIsOpen,
  seasonPhase,
  type SeasonDates,
  type SeasonPhase,
} from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
import { BUTTON_BASE } from './page-control';
import type { PublicOpenSeasonRows } from './organization-path';

export interface LeagueRowSeason extends SeasonDates {
  name: string;
  slug: string;
}

export interface SeasonStatusLine {
  /** Null when the league has no upcoming season, which the line says in plain text. */
  badge: string | null;
  open: boolean;
  text: string;
}

// Constants, not `buttonVariants()` calls, so the public page's chunk loads no class-merging code. The spec checks them against `buttonVariants`.
const REGISTER_VARIANT = 'bg-primary text-primary-foreground [a]:hover:bg-primary/90';
export const REGISTER_BUTTON_LARGE = `${BUTTON_BASE} ${REGISTER_VARIANT} h-11 gap-2 px-5 has-data-[icon=inline-end]:pe-4 has-data-[icon=inline-start]:ps-4`;
export const REGISTER_BUTTON = `${BUTTON_BASE} ${REGISTER_VARIANT} h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3`;

const BADGE =
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-4xl border px-2 py-0.5 text-xs font-medium whitespace-nowrap';
export const OPEN_BADGE = `${BADGE} border-transparent bg-secondary text-secondary-foreground`;
export const OUTLINE_BADGE = `${BADGE} border-border text-foreground`;

// An ended season is never a league's next season; its text only completes the map.
const BADGE_TEXT: Record<SeasonPhase, string> = {
  registrationOpen: 'Registration open',
  registrationClosed: 'Registration closed',
  inProgress: 'In progress',
  ended: 'Ended',
};

/** "May 19" from a stored calendar date, read as text so the server and a browser in any time zone agree. */
export function closesText(registrationDeadline: string): string {
  return formatCalendarDate(registrationDeadline).replace(/, \d+$/, '');
}

/** The earliest-starting season that has not ended. */
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
  const next = nextSeason(seasons, nowMs);
  if (next === undefined) return { badge: null, open: false, text: 'No upcoming season' };
  const phase = seasonPhase(next, nowMs);
  const open = phase === 'registrationOpen';
  return {
    badge: BADGE_TEXT[phase],
    open,
    text: open ? `${next.name} · closes ${closesText(next.registrationDeadline)}` : next.name,
  };
}

/** The seasons registration is open for at `nowMs`, soonest deadline first. */
export function openSeasonsOf(seasons: PublicOpenSeasonRows, nowMs: number): PublicOpenSeasonRows {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return seasons
    .filter((season) => registrationIsOpen(season, nowMs))
    .sort(
      (a, b) =>
        compare(a.registrationDeadline, b.registrationDeadline) ||
        compare(a.league.name, b.league.name) ||
        compare(a.name, b.name),
    );
}
