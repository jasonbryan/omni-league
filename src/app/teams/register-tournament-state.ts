import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { registrationIsOpen } from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';

export type TournamentRegistrationAnswer = FunctionReturnType<
  typeof api.tournaments.getForRegistration
>;

export type RegisterTournamentState =
  'loading' | 'not-found' | 'signed-out' | 'on-team' | 'waitlisted' | 'closed' | 'full' | 'form';

/** "On a team" and "waitlisted" come before "closed", so a rostered player still reaches their team, and a waiting captain still sees their place, after the deadline. "Full" offers the waitlist form. */
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
  if (answer.waitlist) return 'waitlisted';
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
