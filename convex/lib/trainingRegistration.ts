// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import {
  MAX_MINORS_PER_SESSION,
  ageNotConfirmedMessage,
  type Participant,
} from './individualRegistration';
import { trainingClassDate } from './trainingPattern';

export type TrainingRegistrationCode =
  | 'trainingNotFound'
  | 'registrationClosed'
  | 'alreadyRegistered'
  | 'adultNotAllowed'
  | 'minorNotAllowed'
  | 'minorLimit'
  | 'ageNotConfirmed'
  | 'classFull';

export const TRAINING_NOT_FOUND_CODE = 'trainingNotFound';

export interface TrainingRegistrationRefusal {
  code: TrainingRegistrationCode;
  message: string;
  field?: 'ageConfirmed' | 'minorName';
}

export const TRAINING_REGISTRATION_MESSAGES = {
  trainingNotFound: 'This training program is not open for registration.',
  registrationClosed: 'Registration for this training program is closed.',
  alreadyRegistered: (participant: Participant) =>
    participant.kind === 'self'
      ? 'You are already registered for this training program.'
      : `${participant.minorName} is already registered for this training program.`,
  adultNotAllowed: (maximumAge: number) =>
    `This training program is for ages up to ${maximumAge}, so an adult cannot register themself.`,
  minorNotAllowed: (minimumAge: number) =>
    `This training program is for ages ${minimumAge} and over, so a child cannot be registered for it.`,
  minorLimit: `You've registered ${MAX_MINORS_PER_SESSION} children for this training program, which is the most one guardian can register.`,
  ageNotConfirmed: ageNotConfirmedMessage,
  classFull: (date: string) => `${trainingClassDate(date)} is full.`,
} as const;

export function trainingHasAgeRange(ages: {
  minimumAge?: number | undefined;
  maximumAge?: number | undefined;
}): boolean {
  return ages.minimumAge !== undefined || ages.maximumAge !== undefined;
}
