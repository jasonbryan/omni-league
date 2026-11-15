// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import {
  MAX_MINORS_PER_SESSION,
  ageNotConfirmedMessage,
  type Participant,
} from './individualRegistration';

export type CampRegistrationCode =
  | 'campNotFound'
  | 'registrationClosed'
  | 'alreadyRegistered'
  | 'adultNotAllowed'
  | 'minorNotAllowed'
  | 'minorLimit'
  | 'ageNotConfirmed'
  | 'sessionFull';

export const CAMP_NOT_FOUND_CODE = 'campNotFound';

export interface CampRegistrationRefusal {
  code: CampRegistrationCode;
  message: string;
  field?: 'ageConfirmed' | 'minorName';
}

export const CAMP_REGISTRATION_MESSAGES = {
  campNotFound: 'This camp session is not open for registration.',
  registrationClosed: 'Registration for this session is closed.',
  alreadyRegistered: (participant: Participant) =>
    participant.kind === 'self'
      ? 'You are already registered for this session.'
      : `${participant.minorName} is already registered for this session.`,
  adultNotAllowed: (maximumAge: number) =>
    `This camp is for ages up to ${maximumAge}, so an adult cannot register themself.`,
  minorNotAllowed: (minimumAge: number) =>
    `This camp is for ages ${minimumAge} and over, so a child cannot be registered for it.`,
  minorLimit: `You've registered ${MAX_MINORS_PER_SESSION} children for this session, which is the most one guardian can register.`,
  ageNotConfirmed: ageNotConfirmedMessage,
  sessionFull: 'This session is full.',
} as const;
