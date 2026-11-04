import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { registrationIsOpen } from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';

export type RegistrationAnswer = FunctionReturnType<typeof api.seasons.getForRegistration>;

export type RegisterTeamState =
  | 'loading'
  | 'not-found'
  | 'signed-out'
  | 'on-team'
  | 'waitlisted'
  | 'waiting'
  | 'closed'
  | 'full'
  | 'form';

/**
 * The first state that applies, in the order every register route shares. "On a team", "waitlisted" and "waiting" come before "closed",
 * so a rostered player still reaches their team, and a waiting captain or free agent still sees their own state, after the deadline.
 * "Full" limits teams only: the team route offers the waitlist there, and the free-agent route treats it as the form.
 */
export function registerTeamState({
  answer,
  signedIn,
  nowMs,
}: {
  answer: RegistrationAnswer | undefined;
  signedIn: boolean;
  nowMs: number;
}): RegisterTeamState {
  if (answer === undefined) return 'loading';
  if (answer === null) return 'not-found';
  if (!signedIn) return 'signed-out';
  if (answer.team) return 'on-team';
  if (answer.waitlist) return 'waitlisted';
  if (answer.freeAgent?.status === 'waiting') return 'waiting';
  if (!registrationIsOpen(answer, nowMs)) return 'closed';
  return answer.isFull ? 'full' : 'form';
}

/** Registration also closes when the season starts, so a deadline on or after the start date is not the day it closed. */
export function registrationClosedLine(
  season: Pick<NonNullable<RegistrationAnswer>, 'registrationDeadline' | 'startDate'>,
): string {
  return season.registrationDeadline < season.startDate
    ? `It closed on ${formatCalendarDate(season.registrationDeadline)}.`
    : `It closed when the season started on ${formatCalendarDate(season.startDate)}.`;
}
