import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { registrationIsOpen } from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';

export type TournamentRegistrationAnswer = FunctionReturnType<
  typeof api.tournaments.getForRegistration
>;

export type RegisterTournamentState =
  'loading' | 'not-found' | 'signed-out' | 'on-team' | 'closed' | 'full' | 'form';

/** "On a team" comes before "closed", so a rostered player still reaches their team after the deadline. A tournament has no waitlist, so "full" offers no form. */
export function registerTournamentState({
  answer,
  signedIn,
  nowMs,
}: {
  answer: TournamentRegistrationAnswer | undefined;
  signedIn: boolean;
  nowMs: number;
}): RegisterTournamentState {
  if (answer === undefined) return 'loading';
  if (answer === null) return 'not-found';
  if (!signedIn) return 'signed-out';
  if (answer.team) return 'on-team';
  if (!registrationIsOpen(answer, nowMs)) return 'closed';
  return answer.isFull ? 'full' : 'form';
}

/** Registration also closes when the tournament starts, so a deadline on or after the start date is not the day it closed. */
export function tournamentClosedLine(
  tournament: Pick<NonNullable<TournamentRegistrationAnswer>, 'registrationDeadline' | 'startDate'>,
): string {
  return tournament.registrationDeadline < tournament.startDate
    ? `It closed on ${formatCalendarDate(tournament.registrationDeadline)}.`
    : `It closed when the tournament started on ${formatCalendarDate(tournament.startDate)}.`;
}
