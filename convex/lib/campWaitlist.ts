// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import type { Participant } from './individualRegistration';

export type CampWaitlistCode =
  'alreadyWaiting' | 'sessionHasPlace' | 'notWaiting' | 'noFreePlace' | 'notNext';

export const CAMP_WAITLIST_MESSAGES = {
  alreadyWaiting: (participant: Participant) =>
    participant.kind === 'self'
      ? 'You are already on the waitlist for this session.'
      : `${participant.minorName} is already on the waitlist for this session.`,
  sessionHasPlace: 'This session has a place free. Register for it instead.',
  notWaiting: 'This person has already been given a place.',
  noFreePlace: 'No place is free. Raise the places first.',
  notNext: 'Give the place to the person who joined first.',
} as const;

/** A waiting entry holds the next place, so a session with any counts as full whatever its places. */
export function campSessionPlacesLeft(session: {
  places: number;
  registeredCount: number;
  waitlistCount?: number;
}): number {
  if ((session.waitlistCount ?? 0) > 0) return 0;
  return Math.max(0, session.places - session.registeredCount);
}

export function campSessionHasFreePlace(session: {
  places: number;
  registeredCount: number;
}): boolean {
  return session.registeredCount < session.places;
}
