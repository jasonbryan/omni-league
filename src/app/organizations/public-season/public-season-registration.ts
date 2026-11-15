import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import {
  registrationIsOpen,
  seasonPhase,
  type SeasonPhase,
} from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { linkedSeason, soonestClosingOpenSeason, type LinkedSeason } from '../season-status';
import type { PublicSeasonData } from './public-season-view';

export type NextOpenSeason = LinkedSeason;

export type RegistrationCard =
  | { kind: 'open'; phase: 'registrationOpen'; closes: string }
  | { kind: 'full'; phase: 'registrationOpen'; closes: string; note: string }
  | {
      kind: 'closed';
      phase: Exclude<SeasonPhase, 'registrationOpen'>;
      closedOn: string;
      note: string;
      next: NextOpenSeason | undefined;
    };

export type ViewerTeam = NonNullable<
  NonNullable<FunctionReturnType<typeof api.seasons.getForRegistration>>['team']
>;

export interface TeamCard {
  teamId: string;
  name: string;
  role: string;
  invite: string | undefined;
}

function nextOpenSeason(season: PublicSeasonData, nowMs: number): NextOpenSeason | undefined {
  const others = (season.league.upcomingSeasons ?? []).filter(
    (other) => other.slug !== season.slug,
  );
  const open = soonestClosingOpenSeason(others, nowMs);
  return open && linkedSeason(open);
}

export type RegistrationKind = RegistrationCard['kind'];

/** The card's open, full, or closed rule, from the facts a link carries, so the skeleton draws the kind the card will. */
export function registrationKind(
  registration: { deadline: string; startDate: string; isFull: boolean },
  nowMs: number,
): RegistrationKind {
  const open = registrationIsOpen(
    { registrationDeadline: registration.deadline, startDate: registration.startDate },
    nowMs,
  );
  if (!open) return 'closed';
  return registration.isFull ? 'full' : 'open';
}

const OPEN_NOTE =
  'Captains register a team, then invite their players. Without a team? Register as a free agent, and an organizer places you on one.';

function waitlistNote(closes: string): string {
  return `Join the waitlist and an organizer offers you a place if one opens. Registration closes ${closes}.`;
}

/** The title and note of the open and full cards, shared by the card and its skeleton so the skeleton's bars wrap as the card's text does. */
export function openOrFullLines(
  kind: 'open' | 'full',
  closes: string,
): { title: string; note: string } {
  return kind === 'open'
    ? { title: `Registration open · closes ${closes}`, note: OPEN_NOTE }
    : { title: 'This season is full', note: waitlistNote(closes) };
}

export function registrationLines(card: Extract<RegistrationCard, { kind: 'open' | 'full' }>): {
  title: string;
  note: string;
} {
  return openOrFullLines(card.kind, card.closes);
}

/** Undefined for a saved copy made before the query held the deadline: it cannot say whether registration is open. */
export function registrationCard(
  season: PublicSeasonData,
  nowMs: number,
): RegistrationCard | undefined {
  const { registrationDeadline } = season;
  if (registrationDeadline === undefined) return undefined;
  const phase = seasonPhase({ ...season, registrationDeadline }, nowMs);
  const closes = formatCalendarDate(registrationDeadline);
  if (phase === 'registrationOpen') {
    if (!season.isFull) return { kind: 'open', phase, closes };
    return { kind: 'full', phase, closes, note: waitlistNote(closes) };
  }
  const note =
    phase === 'inProgress'
      ? 'This season is underway.'
      : phase === 'ended'
        ? 'This season has ended.'
        : `This season starts ${formatCalendarDate(season.startDate)}.`;
  return { kind: 'closed', phase, closedOn: closes, note, next: nextOpenSeason(season, nowMs) };
}

function rosterAgainstMinimum(rosterCount: number, minimum: number): string {
  return rosterCount > minimum
    ? `${rosterCount} players, at least ${minimum} needed`
    : `${rosterCount} of the ${minimum} players needed`;
}

export function teamCard(team: ViewerTeam, season: PublicSeasonData, nowMs: number): TeamCard {
  const { minimumRosterSize, registrationDeadline, startDate } = season;
  const missing = minimumRosterSize - team.rosterCount;
  const openUntil =
    registrationDeadline !== undefined &&
    registrationIsOpen({ registrationDeadline, startDate }, nowMs)
      ? formatCalendarDate(registrationDeadline)
      : undefined;
  const players = missing === 1 ? 'one more player' : `${missing} more players`;
  return {
    teamId: team.teamId,
    name: team.name,
    role: `${team.isCaptain ? 'Captain' : 'Player'} · ${rosterAgainstMinimum(team.rosterCount, minimumRosterSize)}`,
    invite:
      team.isCaptain && missing > 0 && openUntil
        ? `Invite ${players} before ${openUntil} to reach the minimum.`
        : undefined,
  };
}
