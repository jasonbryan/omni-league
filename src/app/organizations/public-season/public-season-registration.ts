import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import {
  registrationIsOpen,
  seasonPhase,
  type SeasonPhase,
} from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { soonestClosingOpenSeason } from '../season-status';
import type { PublicSeasonData } from './public-season-view';

export interface NextOpenSeason {
  name: string;
  slug: string;
}

export type RegistrationCard =
  | { kind: 'open'; phase: 'registrationOpen'; closes: string }
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
  return open && { name: open.name, slug: open.slug };
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
  if (phase === 'registrationOpen') return { kind: 'open', phase, closes };
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
