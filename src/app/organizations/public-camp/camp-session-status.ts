import { seasonPhase } from '../../../../convex/lib/registration';
import type { HlmBadgeVariant } from '../../ui/badge';
import { BADGE_TEXT } from '../season-status';

export interface CampSessionStatus {
  places: string;
  /** Null for a full session that is open to registration, which its places line already says. */
  badge: string | null;
  badgeVariant: HlmBadgeVariant | null;
  full: boolean;
}

/** Follows the seasons' phases, so a deadline passes at the same moment for a season, a tournament, and a camp session. */
export function campSessionStatus(
  session: { startDate: string; endDate: string; registrationDeadline: string; placesLeft: number },
  nowMs: number,
): CampSessionStatus {
  const phase = seasonPhase(session, nowMs);
  const full = session.placesLeft === 0;
  const places = full
    ? 'Full'
    : `${session.placesLeft} ${session.placesLeft === 1 ? 'place' : 'places'} left`;
  if (phase === 'registrationOpen') {
    return full
      ? { places, badge: null, badgeVariant: null, full }
      : { places, badge: BADGE_TEXT[phase], badgeVariant: 'secondary', full };
  }
  return { places, badge: BADGE_TEXT[phase], badgeVariant: 'muted', full };
}
