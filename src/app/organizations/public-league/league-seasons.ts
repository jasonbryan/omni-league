import { seasonPhase } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { BADGE_TEXT } from '../season-status';
import type { PublicLeagueHeader } from './public-league-path';

export type LeaguePageSeason = NonNullable<PublicLeagueHeader['seasons']>[number];

export interface SeasonStatus {
  badge: string;
  open: boolean;
  note: string | undefined;
}

/** Undefined for a row from a saved copy made before rows held their deadline: it cannot say which phase the season is in. */
export function seasonStatus(
  season: { startDate: string; endDate: string; registrationDeadline?: string | undefined },
  nowMs: number,
): SeasonStatus | undefined {
  const { startDate, endDate, registrationDeadline } = season;
  if (registrationDeadline === undefined) return undefined;
  const phase = seasonPhase({ startDate, endDate, registrationDeadline }, nowMs);
  return {
    badge: BADGE_TEXT[phase],
    open: phase === 'registrationOpen',
    note:
      phase === 'registrationOpen'
        ? `closes ${formatCalendarDate(registrationDeadline)}`
        : phase === 'inProgress'
          ? 'registration closed'
          : undefined,
  };
}
