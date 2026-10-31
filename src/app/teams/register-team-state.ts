import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../convex/_generated/api';
import { registrationIsOpen } from '../../../convex/lib/registration';

export type RegistrationAnswer = FunctionReturnType<typeof api.seasons.getForRegistration>;

export type RegisterTeamState =
  'loading' | 'not-found' | 'signed-out' | 'on-team' | 'closed' | 'form';

/**
 * The first state that applies, in the order every register route shares. "On a team" comes before "closed", so a rostered player still
 * reaches their team from here after the deadline.
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
  return registrationIsOpen(answer, nowMs) ? 'form' : 'closed';
}
