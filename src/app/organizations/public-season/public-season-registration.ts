import {
  registrationIsOpen,
  seasonPhase,
  type SeasonPhase,
} from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { compare } from '../season-status';
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

function nextOpenSeason(season: PublicSeasonData, nowMs: number): NextOpenSeason | undefined {
  const open = (season.league.upcomingSeasons ?? [])
    .filter((other) => other.slug !== season.slug && registrationIsOpen(other, nowMs))
    .sort((a, b) => compare(a.registrationDeadline, b.registrationDeadline));
  return open[0] && { name: open[0].name, slug: open[0].slug };
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
