// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import { ORGANIZATION_MESSAGES } from './organizationInput';
import {
  HIDDEN_CHARACTER_MESSAGE,
  hasControlOrBidiCharacter,
  hasVisibleCharacter,
} from './nameCharacters';
import { isChoosableSlug, slugTakenMessage } from './slugs';
import type { Sport } from './sports';

export const MAX_TRAINING_NAME_LENGTH = 100;
export const MAX_COACH_NAME_LENGTH = 100;

export const MIN_TRAINING_AGE = 4;
export const MAX_TRAINING_AGE = 99;

export type TrainingField =
  'name' | 'slug' | 'sport' | 'locations' | 'coachName' | 'minimumAge' | 'maximumAge';

// The order of the page, which is the order focus follows to the first invalid field.
export const TRAINING_FIELDS: readonly TrainingField[] = [
  'name',
  'slug',
  'sport',
  'locations',
  'coachName',
  'minimumAge',
  'maximumAge',
];

export type TrainingInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameInvisible'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'sportEmpty'
  | 'locationsEmpty'
  | 'coachEmpty'
  | 'coachTooLong'
  | 'coachInvisible'
  | 'ageInvalid'
  | 'agesReversed';

export const TRAINING_PUBLISH_MESSAGES = {
  noClasses: 'Schedule the classes first.',
} as const;

export interface TrainingInputError {
  field: TrainingField;
  code: TrainingInputCode;
  message: string;
}

export const TRAINING_MESSAGES = {
  nameEmpty: 'Enter the training program’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_TRAINING_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  nameInvisible: HIDDEN_CHARACTER_MESSAGE,
  slugEmpty: 'Enter a web address for the training program.',
  slugInvalid: ORGANIZATION_MESSAGES.slugInvalid,
  slugTaken: slugTakenMessage,
  sportEmpty: 'Choose a sport.',
  locationsEmpty: 'Choose at least one location.',
  coachEmpty: 'Enter the coach’s name.',
  coachTooLong: (length: number) =>
    `Use ${MAX_COACH_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  coachInvisible: HIDDEN_CHARACTER_MESSAGE,
  ageInvalid: `Enter a whole number of years from ${MIN_TRAINING_AGE} to ${MAX_TRAINING_AGE}, or leave it blank.`,
  agesReversed: (minimumAge: number) =>
    `The oldest age must be no lower than the youngest age, ${minimumAge}.`,
} as const;

export interface TrainingValues {
  name: string;
  slug: string;
  /** `null` while none is chosen, which only the form can be in. */
  sport: Sport | null;
  locationCount: number;
  coachName: string;
  /** `undefined` while none is entered, which is allowed; text that is not a number is `NaN`. */
  minimumAge: number | undefined;
  maximumAge: number | undefined;
}

type Errors = Partial<Record<TrainingField, TrainingInputError>>;

type TextKind = 'name' | 'coach';

function textError(kind: TextKind, text: string): TrainingInputError | null {
  const field = kind === 'name' ? 'name' : 'coachName';
  const maximum = kind === 'name' ? MAX_TRAINING_NAME_LENGTH : MAX_COACH_NAME_LENGTH;
  const trimmed = text.trim();
  if (!hasVisibleCharacter(trimmed)) {
    return { field, code: `${kind}Empty`, message: TRAINING_MESSAGES[`${kind}Empty`] };
  }
  if (trimmed.length > maximum) {
    return {
      field,
      code: `${kind}TooLong`,
      message: TRAINING_MESSAGES[`${kind}TooLong`](trimmed.length),
    };
  }
  if (hasControlOrBidiCharacter(trimmed)) {
    return { field, code: `${kind}Invisible`, message: TRAINING_MESSAGES[`${kind}Invisible`] };
  }
  return null;
}

function slugError(slug: string): TrainingInputError | null {
  if (slug === '') {
    return { field: 'slug', code: 'slugEmpty', message: TRAINING_MESSAGES.slugEmpty };
  }
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: TRAINING_MESSAGES.slugInvalid };
  }
  return null;
}

function isTrainingAge(age: number): boolean {
  return Number.isInteger(age) && age >= MIN_TRAINING_AGE && age <= MAX_TRAINING_AGE;
}

function ageError(
  field: 'minimumAge' | 'maximumAge',
  age: number | undefined,
): TrainingInputError | null {
  if (age === undefined || isTrainingAge(age)) return null;
  return { field, code: 'ageInvalid', message: TRAINING_MESSAGES.ageInvalid };
}

function ageErrors({ minimumAge, maximumAge }: TrainingValues): Errors {
  const errors: Errors = {};
  const minimum = ageError('minimumAge', minimumAge);
  if (minimum) errors.minimumAge = minimum;
  const maximum = ageError('maximumAge', maximumAge);
  if (maximum) errors.maximumAge = maximum;
  if (
    !minimum &&
    !maximum &&
    minimumAge !== undefined &&
    maximumAge !== undefined &&
    minimumAge > maximumAge
  ) {
    errors.maximumAge = {
      field: 'maximumAge',
      code: 'agesReversed',
      message: TRAINING_MESSAGES.agesReversed(minimumAge),
    };
  }
  return errors;
}

export function checkTrainingFields(values: TrainingValues): Errors {
  const errors: Errors = {};
  const name = textError('name', values.name);
  if (name) errors.name = name;
  const slug = slugError(values.slug);
  if (slug) errors.slug = slug;
  if (values.sport === null) {
    errors.sport = { field: 'sport', code: 'sportEmpty', message: TRAINING_MESSAGES.sportEmpty };
  }
  if (values.locationCount === 0) {
    errors.locations = {
      field: 'locations',
      code: 'locationsEmpty',
      message: TRAINING_MESSAGES.locationsEmpty,
    };
  }
  const coach = textError('coach', values.coachName);
  if (coach) errors.coachName = coach;
  Object.assign(errors, ageErrors(values));
  return errors;
}

export function firstTrainingError(errors: Errors): TrainingInputError | null {
  for (const field of TRAINING_FIELDS) {
    const error = errors[field];
    if (error) return error;
  }
  return null;
}

export function trainingAgesLabel(
  minimumAge: number | undefined,
  maximumAge: number | undefined,
): string {
  if (minimumAge !== undefined && maximumAge !== undefined) {
    return minimumAge === maximumAge ? `Age ${minimumAge}` : `${minimumAge} to ${maximumAge}`;
  }
  if (minimumAge !== undefined) return `${minimumAge} or older`;
  if (maximumAge !== undefined) return `${maximumAge} or younger`;
  return 'All ages';
}
