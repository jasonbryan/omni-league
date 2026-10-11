// What an org admin may type when inviting staff (#67), checked in the browser and again by
// `invites.create` with the same rules and messages (design/mockups/67-organization-staff.html,
// "Staff messages"). Imports nothing, so the app can import it (convex.md, Functions).

/** How long an invite works: 14 days from creation (#67). Expired invites stay `pending`. */
export const INVITE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** The longest address, as RFC 5321 allows. */
export const MAX_INVITE_EMAIL_LENGTH = 254;

export type InviteInputCode =
  'emailEmpty' | 'emailInvalid' | 'leaguesEmpty' | 'alreadyMember' | 'alreadyInvited';

export type InviteField = 'email' | 'leagues';

/** A refusal about one field: the `data` of the `ConvexError` that `invites.create` throws. */
export interface InviteInputError {
  field: InviteField;
  code: InviteInputCode;
  message: string;
}

export const INVITE_MESSAGES = {
  emailEmpty: 'Enter their email address.',
  emailInvalid: 'Enter an email address like name@example.com.',
  leaguesEmpty: 'Choose at least one league.',
  alreadyMember: (email: string) => `${email} is already on your staff.`,
  alreadyInvited: (email: string) =>
    `${email} already has a pending invite. To send a new link, revoke that invite first.`,
} as const;

/** The address as stored and compared: trimmed and lower case (Better Auth stores it that way). */
export function normaliseInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** One `@`, text on both sides, and a dot in the domain, with no spaces. */
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** The address to store (normalised), or the refusal. */
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

/** The refusal when a league organizer has no league chosen, or `null`. */
export function checkInviteLeagues(leagueCount: number): InviteInputError | null {
  return leagueCount === 0
    ? { field: 'leagues', code: 'leaguesEmpty', message: INVITE_MESSAGES.leaguesEmpty }
    : null;
}
