import { seasonPhase } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { BADGE_TEXT, FULL_BADGE_TEXT, isOpenAndFull } from '../season-status';
import type { HlmBadgeVariant } from '../../ui/badge';
import type { PublicLeagueHeader } from './public-league-path';

export type LeaguePageSeason = NonNullable<PublicLeagueHeader['seasons']>[number];

export interface SeasonStatus {
  badge: string;
  badgeVariant: HlmBadgeVariant;
  note: string | undefined;
}

/** Undefined for a row from a saved copy made before rows held their deadline: it cannot say which phase the season is in. */
export function seasonStatus(
  season: {
    startDate: string;
    endDate: string;
    registrationDeadline?: string | undefined;
    isFull?: boolean | undefined;
  },
  nowMs: number,
): SeasonStatus | undefined {
  const { startDate, endDate, registrationDeadline } = season;
  if (registrationDeadline === undefined) return undefined;
  const phase = seasonPhase({ startDate, endDate, registrationDeadline }, nowMs);
  if (isOpenAndFull(phase, season)) {
    return { badge: FULL_BADGE_TEXT, badgeVariant: 'outline', note: 'waitlist open' };
  }
  return {
    badge: BADGE_TEXT[phase],
    badgeVariant: phase === 'registrationOpen' ? 'secondary' : 'muted',
    note:
      phase === 'registrationOpen'
        ? `closes ${formatCalendarDate(registrationDeadline)}`
        : phase === 'inProgress'
          ? 'registration closed'
          : undefined,
  };
}
