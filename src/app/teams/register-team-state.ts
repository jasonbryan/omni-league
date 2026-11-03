import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { registrationIsOpen } from '../../../convex/lib/registration';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';

export type RegistrationAnswer = FunctionReturnType<typeof api.seasons.getForRegistration>;

export type RegisterTeamState =
  'loading' | 'not-found' | 'signed-out' | 'on-team' | 'waiting' | 'closed' | 'form';

/**
 * The first state that applies, in the order every register route shares. "On a team" and "waiting" come before "closed", so a rostered
 * player still reaches their team, and a waiting free agent still sees their own state, after the deadline.
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
  if (answer.freeAgent?.status === 'waiting') return 'waiting';
  return registrationIsOpen(answer, nowMs) ? 'form' : 'closed';
}

/** Registration also closes when the season starts, so a deadline on or after the start date is not the day it closed. */
export function registrationClosedLine(
  season: Pick<NonNullable<RegistrationAnswer>, 'registrationDeadline' | 'startDate'>,
): string {
  return season.registrationDeadline < season.startDate
    ? `It closed on ${formatCalendarDate(season.registrationDeadline)}.`
    : `It closed when the season started on ${formatCalendarDate(season.startDate)}.`;
}
