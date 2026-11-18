// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import type { Participant } from './individualRegistration';

export type TrainingWaitlistCode =
  | 'alreadyWaiting'
  | 'seriesHasPlace'
  | 'notWaiting'
  | 'noFreePlace'
  | 'notNext'
  | 'noUpcomingClass';

export const TRAINING_WAITLIST_MESSAGES = {
  alreadyWaiting: (participant: Participant) =>
    participant.kind === 'self'
      ? 'You are already on the waitlist for this training program.'
      : `${participant.minorName} is already on the waitlist for this training program.`,
  seriesHasPlace: 'Every class has a place free. Register for the series instead.',
  notWaiting: 'This person has already been given a place.',
  noFreePlace: 'No place is free in every class. Raise the places first.',
  notNext: 'Give the places to the person who joined first.',
  noUpcomingClass: 'Every class has passed or is cancelled.',
} as const;
