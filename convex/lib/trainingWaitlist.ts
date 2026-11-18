// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import type { Participant } from './individualRegistration';
import { trainingClassDate } from './trainingPattern';

export type TrainingWaitlistCode =
  | 'alreadyWaiting'
  | 'alreadyWaitingForClass'
  | 'seriesHasPlace'
  | 'notWaiting'
  | 'noFreePlace'
  | 'notNext'
  | 'noUpcomingClass'
  | 'accountGone'
  | 'classHasPlace'
  | 'classGone'
  | 'waitingForClass';

export const TRAINING_WAITLIST_MESSAGES = {
  alreadyWaiting: (participant: Participant) =>
    participant.kind === 'self'
      ? 'You are already on the waitlist for this training program.'
      : `${participant.minorName} is already on the waitlist for this training program.`,
  seriesHasPlace: 'Every class has a place free. Register for the series instead.',
  notWaiting: 'This person has already been given a place.',
  noFreePlace: 'No place is free in every class. Raise the places first.',
  noFreePlaceInClass: 'No place is free in this class. Raise its places first.',
  notNext: 'Give the places to the person who joined first.',
  noUpcomingClass: 'Every class has passed or is cancelled.',
  accountGone: 'This account was removed, so it cannot be given a place.',
  classHasPlace: 'This class has a place free. Register for it instead.',
  classGone: 'This class has passed or is cancelled.',
  alreadyWaitingForClass: (participant: Participant, classDate: string) =>
    participant.kind === 'self'
      ? `You are already on the waitlist for ${trainingClassDate(classDate)}.`
      : `${participant.minorName} is already on the waitlist for ${trainingClassDate(classDate)}.`,
  waitingForClass: (participant: Participant) =>
    participant.kind === 'self'
      ? 'You are on the waitlist for a class of this training program, so you cannot register for the series until you have that place.'
      : `${participant.minorName} is on the waitlist for a class of this training program, so cannot be registered for the series until they have that place.`,
} as const;
