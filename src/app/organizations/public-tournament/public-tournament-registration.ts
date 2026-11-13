import { registrationIsOpen } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import type { PublicTournamentData } from './public-tournament-view';

export type TournamentRegistrationCard =
  | { kind: 'open'; closes: string }
  | { kind: 'full'; maximumTeams: number }
  | { kind: 'closed'; deadline: string };

/** `isFull` is absent on a saved copy made before it existed, which reads as open. */
export function tournamentRegistrationCard(
  tournament: Pick<
    PublicTournamentData,
    'registrationDeadline' | 'startDate' | 'maximumTeams' | 'isFull'
  >,
  nowMs: number,
): TournamentRegistrationCard {
  const deadline = formatCalendarDate(tournament.registrationDeadline);
  if (!registrationIsOpen(tournament, nowMs)) return { kind: 'closed', deadline };
  return tournament.isFull
    ? { kind: 'full', maximumTeams: tournament.maximumTeams }
    : { kind: 'open', closes: deadline };
}
