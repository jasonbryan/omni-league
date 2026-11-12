import { registrationIsOpen } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import type { PublicTournamentData } from './public-tournament-view';

export type TournamentRegistrationCard =
  { kind: 'open'; closes: string } | { kind: 'closed'; deadline: string };

export function tournamentRegistrationCard(
  tournament: Pick<PublicTournamentData, 'registrationDeadline' | 'startDate'>,
  nowMs: number,
): TournamentRegistrationCard {
  const deadline = formatCalendarDate(tournament.registrationDeadline);
  return registrationIsOpen(tournament, nowMs)
    ? { kind: 'open', closes: deadline }
    : { kind: 'closed', deadline };
}
