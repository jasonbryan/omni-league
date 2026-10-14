// Imports nothing, so the app can import it.
export const INVITE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

// Enforced by `invites.restore`, not the page.
export const INVITE_RESTORE_WINDOW_MINUTES = 10;
export const INVITE_RESTORE_WINDOW_MS = INVITE_RESTORE_WINDOW_MINUTES * 60 * 1000;

/** The longest address, as RFC 5321 allows. */
export const MAX_INVITE_EMAIL_LENGTH = 254;

export type InviteInputCode =
  'emailEmpty' | 'emailInvalid' | 'leaguesEmpty' | 'alreadyMember' | 'alreadyInvited';

export type InviteField = 'email' | 'leagues';

export interface InviteInputError {
  field: InviteField;
  code: InviteInputCode;
  message: string;
}

export type InviteRestoreCode =
  'alreadyMember' | 'alreadyInvited' | 'windowPassed' | 'expired' | 'leaguesGone';

export interface InviteRestoreError {
  code: 'windowPassed' | 'expired' | 'leaguesGone';
  message: string;
}

export const INVITE_MESSAGES = {
  emailEmpty: 'Enter their email address.',
  emailInvalid: 'Enter an email address like name@example.com.',
  leaguesEmpty: 'Choose at least one league.',
  alreadyMember: (email: string) => `${email} is already on your staff.`,
  alreadyInvited: (email: string) =>
    `${email} already has a pending invite. To send a new link, revoke that invite first.`,
  restoreWindowPassed: `You can undo a revoke for ${INVITE_RESTORE_WINDOW_MINUTES} minutes. That time has passed. Invite this address again.`,
  restoreExpired:
    'This invite had expired, so its link cannot work again. Invite this address again.',
  restoreAlreadyInvited: (email: string) =>
    `${email} already has a newer pending invite, so the old link stays revoked.`,
  restoreLeaguesGone:
    'A league on this invite no longer exists. Invite this address again with the leagues you want.',
} as const;

// Better Auth stores addresses trimmed and in lower case.
export function normaliseInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function checkInviteEmail(
  email: string,
): { ok: true; email: string } | { ok: false; error: InviteInputError } {
  const normalised = normaliseInviteEmail(email);
  if (normalised === '') {
    return {
      ok: false,
      error: { field: 'email', code: 'emailEmpty', message: INVITE_MESSAGES.emailEmpty },
    };
  }
  if (normalised.length > MAX_INVITE_EMAIL_LENGTH || !SHAPE.test(normalised)) {
    return {
      ok: false,
      error: { field: 'email', code: 'emailInvalid', message: INVITE_MESSAGES.emailInvalid },
    };
  }
  return { ok: true, email: normalised };
}

export function checkInviteLeagues(leagueCount: number): InviteInputError | null {
  return leagueCount === 0
    ? { field: 'leagues', code: 'leaguesEmpty', message: INVITE_MESSAGES.leaguesEmpty }
    : null;
}
