// Imports only `inviteInput.ts`, which imports nothing, so the app can import it.
import { checkInviteEmail, INVITE_MESSAGES } from './inviteInput';

/** More than a team holds, so the list is bounded whatever the captain does. */
export const TEAM_INVITE_LIST_LIMIT = 200;

export type TeamInviteCode = 'emailEmpty' | 'emailInvalid' | 'alreadyOnTeam' | 'alreadyInvited';

export interface TeamInviteInputError {
  field: 'email';
  code: TeamInviteCode;
  message: string;
}

export const TEAM_INVITE_MESSAGES = {
  alreadyOnTeam: (email: string) => `${email} is already on the team.`,
  alreadyInvited: INVITE_MESSAGES.alreadyInvited,
} as const;

export function checkTeamInviteEmail(
  email: string,
): { ok: true; email: string } | { ok: false; error: TeamInviteInputError } {
  const checked = checkInviteEmail(email);
  if (checked.ok) return checked;
  const { code, message } = checked.error;
  return {
    ok: false,
    error: { field: 'email', code: code === 'emailEmpty' ? 'emailEmpty' : 'emailInvalid', message },
  };
}

/** The link a captain sends: the token stays in the fragment, so no server or log sees it. */
export function teamInviteLink(origin: string, token: string): string {
  return `${origin}/teams/join#${token}`;
}

/** `alreadyOnAnotherTeam`, with the other team's name, and `waitingFreeAgent` come from the roster writer. */
export type TeamInviteAcceptCode =
  'invalid' | 'emailMismatch' | 'alreadyOnTeam' | 'alreadyOnAnotherTeam' | 'waitingFreeAgent';
