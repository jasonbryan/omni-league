// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import { v, type Infer } from 'convex/values';
import { formatCalendarDate } from './seasonInput';

export const ADULT_AGE = 18;

export const campParticipantValidator = v.union(
  v.object({ kind: v.literal('self') }),
  v.object({ kind: v.literal('minor'), minorName: v.string() }),
);

export type CampParticipant = Infer<typeof campParticipantValidator>;

export const selfParticipantValidator = v.object({ kind: v.literal('self') });

export const SELF_PARTICIPANT = { kind: 'self' } as const;

export function participantKey(participant: CampParticipant): string {
  return participant.kind === 'self' ? 'self' : `minor:${participant.minorName.toLowerCase()}`;
}

/** Camps and training read this one rule. `undefined` is no maximum. */
export function adultMayRegister(maximumAge: number | undefined): boolean {
  return maximumAge === undefined || maximumAge >= ADULT_AGE;
}

export function ageConfirmationLabel(
  minimumAge: number,
  maximumAge: number,
  startDate: string,
): string {
  const years =
    minimumAge === maximumAge
      ? `${minimumAge} years old`
      : `${minimumAge} to ${maximumAge} years old`;
  return `I am ${years} on ${formatCalendarDate(startDate)}`;
}

export type CampRegistrationCode =
  | 'campNotFound'
  | 'registrationClosed'
  | 'alreadyRegistered'
  | 'adultNotAllowed'
  | 'ageNotConfirmed'
  | 'sessionFull';

export const CAMP_NOT_FOUND_CODE = 'campNotFound';

export interface CampRegistrationRefusal {
  code: CampRegistrationCode;
  message: string;
  field?: 'ageConfirmed';
}

export const CAMP_REGISTRATION_MESSAGES = {
  campNotFound: 'This camp session is not open for registration.',
  registrationClosed: 'Registration for this session is closed.',
  alreadyRegistered: 'You are already registered for this session.',
  adultNotAllowed: (maximumAge: number) =>
    `This camp is for ages up to ${maximumAge}, so an adult cannot register themself.`,
  ageNotConfirmed: 'Confirm your age to continue.',
  sessionFull: 'This session is full.',
} as const;
