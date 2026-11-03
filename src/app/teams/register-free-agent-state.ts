import {
  registerTeamState,
  type RegistrationAnswer,
  type RegisterTeamState,
} from './register-team-state';

export type RegisterFreeAgentState = RegisterTeamState | 'waiting';

/**
 * The team route's order with "waiting" after "on a team" and before "closed": organizers place free agents after the deadline, so a
 * waiting free agent keeps seeing their own state once registration closes.
 */
export function registerFreeAgentState(args: {
  answer: RegistrationAnswer | undefined;
  signedIn: boolean;
  nowMs: number;
}): RegisterFreeAgentState {
  const state = registerTeamState(args);
  const waiting = args.answer?.freeAgent?.status === 'waiting';
  return waiting && (state === 'closed' || state === 'form') ? 'waiting' : state;
}
