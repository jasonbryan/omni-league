// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import { v, type Infer } from 'convex/values';
import { minorNameKey, normalizeMinorName } from './minorName';
import { formatCalendarDate } from './seasonInput';

export const ADULT_AGE = 18;

export const MAX_MINORS_PER_SESSION = 20;

export const participantValidator = v.union(
  v.object({ kind: v.literal('self') }),
  v.object({ kind: v.literal('minor'), minorName: v.string() }),
);

export type Participant = Infer<typeof participantValidator>;

export const SELF_PARTICIPANT = { kind: 'self' } as const;

export const SELF_KEY = 'self';

export const MINOR_KEY_PREFIX = 'minor:';

/** Every key that starts with `minor:` sorts below this one, since `;` is the character after `:`. */
export const MINOR_KEY_END = 'minor;';

export function participantKey(participant: Participant): string {
  return participant.kind === 'self'
    ? SELF_KEY
    : `${MINOR_KEY_PREFIX}${minorNameKey(participant.minorName)}`;
}

/** `undefined` is no maximum. */
export function adultMayRegister(maximumAge: number | undefined): boolean {
  return maximumAge === undefined || maximumAge >= ADULT_AGE;
}

/** A minor cannot truthfully confirm an age range that starts at 18. `undefined` is no minimum. */
export function minorMayRegister(minimumAge: number | undefined): boolean {
  return minimumAge === undefined || minimumAge < ADULT_AGE;
}

export function participantsOffered(ages: {
  minimumAge: number | undefined;
  maximumAge: number | undefined;
}): ('self' | 'minor')[] {
  return [
    ...(adultMayRegister(ages.maximumAge) ? (['self'] as const) : []),
    ...(minorMayRegister(ages.minimumAge) ? (['minor'] as const) : []),
  ];
}

function yearsOld(minimumAge: number, maximumAge: number): string {
  return minimumAge === maximumAge
    ? `${minimumAge} years old`
    : `${minimumAge} to ${maximumAge} years old`;
}

export function ageConfirmationLabel(
  participant: Participant,
  minimumAge: number,
  maximumAge: number,
  startDate: string,
): string {
  const years = `${yearsOld(minimumAge, maximumAge)} on ${formatCalendarDate(startDate)}`;
  if (participant.kind === 'self') return `I am ${years}`;
  const name = normalizeMinorName(participant.minorName);
  return `${name === '' ? 'My child' : name} is ${years}.`;
}

export function ageNotConfirmedMessage(participant: Participant): string {
  if (participant.kind === 'self') return 'Confirm your age to continue.';
  const name = normalizeMinorName(participant.minorName);
  return `Confirm ${name === '' ? 'your child' : name}'s age to continue.`;
}
