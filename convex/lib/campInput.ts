// Imports only `convex/values` and other `convex/lib` files that do the same, so the app can import it.
import { ORGANIZATION_MESSAGES } from './organizationInput';
import {
  HIDDEN_CHARACTER_MESSAGE,
  hasControlOrBidiCharacter,
  hasVisibleCharacter,
} from './nameCharacters';
import { isChoosableSlug, slugTakenMessage } from './slugs';
import type { Sport } from './sports';

export const MAX_CAMP_NAME_LENGTH = 100;

export const MIN_CAMP_AGE = 4;
export const MAX_CAMP_AGE = 99;

export type CampField = 'name' | 'slug' | 'sport' | 'locations' | 'minimumAge' | 'maximumAge';

// The order of the page, which is the order focus follows to the first invalid field.
export const CAMP_FIELDS: readonly CampField[] = [
  'name',
  'slug',
  'sport',
  'locations',
  'minimumAge',
  'maximumAge',
];

export type CampInputCode =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameInvisible'
  | 'slugEmpty'
  | 'slugInvalid'
  | 'slugTaken'
  | 'sportEmpty'
  | 'locationsEmpty'
  | 'ageEmpty'
  | 'ageInvalid'
  | 'agesReversed';

export interface CampInputError {
  field: CampField;
  code: CampInputCode;
  message: string;
}

const AGE_RANGE = `from ${MIN_CAMP_AGE} to ${MAX_CAMP_AGE}`;

export const CAMP_MESSAGES = {
  nameEmpty: 'Enter the camp’s name.',
  nameTooLong: (length: number) =>
    `Use ${MAX_CAMP_NAME_LENGTH} characters or fewer. This name has ${length}.`,
  nameInvisible: HIDDEN_CHARACTER_MESSAGE,
  slugEmpty: 'Enter a web address for the camp.',
  slugInvalid: ORGANIZATION_MESSAGES.slugInvalid,
  slugTaken: slugTakenMessage,
  sportEmpty: 'Choose a sport.',
  locationsEmpty: 'Choose at least one location.',
  minimumAgeEmpty: `Enter the youngest age, ${AGE_RANGE}.`,
  maximumAgeEmpty: `Enter the oldest age, ${AGE_RANGE}.`,
  ageInvalid: `Enter a whole number of years ${AGE_RANGE}.`,
  agesReversed: (minimumAge: number) =>
    `The oldest age must be no lower than the youngest age, ${minimumAge}.`,
} as const;

export interface CampValues {
  name: string;
  slug: string;
  /** `null` while none is chosen, which only the form can be in. */
  sport: Sport | null;
  locationCount: number;
  /** `undefined` while none is entered; text that is not a number is `NaN`. */
  minimumAge: number | undefined;
  maximumAge: number | undefined;
}

type Errors = Partial<Record<CampField, CampInputError>>;

function nameError(name: string): CampInputError | null {
  const trimmed = name.trim();
  const field = 'name';
  if (!hasVisibleCharacter(trimmed)) {
    return { field, code: 'nameEmpty', message: CAMP_MESSAGES.nameEmpty };
  }
  if (trimmed.length > MAX_CAMP_NAME_LENGTH) {
    return { field, code: 'nameTooLong', message: CAMP_MESSAGES.nameTooLong(trimmed.length) };
  }
  if (hasControlOrBidiCharacter(trimmed)) {
    return { field, code: 'nameInvisible', message: CAMP_MESSAGES.nameInvisible };
  }
  return null;
}

function slugError(slug: string): CampInputError | null {
  if (slug === '') return { field: 'slug', code: 'slugEmpty', message: CAMP_MESSAGES.slugEmpty };
  if (!isChoosableSlug(slug)) {
    return { field: 'slug', code: 'slugInvalid', message: CAMP_MESSAGES.slugInvalid };
  }
  return null;
}

function isCampAge(age: number): boolean {
  return Number.isInteger(age) && age >= MIN_CAMP_AGE && age <= MAX_CAMP_AGE;
}

function ageError(field: 'minimumAge' | 'maximumAge', age: number | undefined) {
  if (age === undefined) {
    return { field, code: 'ageEmpty', message: CAMP_MESSAGES[`${field}Empty`] } as const;
  }
  return isCampAge(age)
    ? null
    : ({ field, code: 'ageInvalid', message: CAMP_MESSAGES.ageInvalid } as const);
}

function ageErrors({ minimumAge, maximumAge }: CampValues): Errors {
  const errors: Errors = {};
  const minimum = ageError('minimumAge', minimumAge);
  if (minimum) errors.minimumAge = minimum;
  const maximum = ageError('maximumAge', maximumAge);
  if (maximum) errors.maximumAge = maximum;
  if (!minimum && !maximum && minimumAge! > maximumAge!) {
    errors.maximumAge = {
      field: 'maximumAge',
      code: 'agesReversed',
      message: CAMP_MESSAGES.agesReversed(minimumAge!),
    };
  }
  return errors;
}

export function checkCampFields(values: CampValues): Errors {
  const errors: Errors = {};
  const name = nameError(values.name);
  if (name) errors.name = name;
  const slug = slugError(values.slug);
  if (slug) errors.slug = slug;
  if (values.sport === null) {
    errors.sport = { field: 'sport', code: 'sportEmpty', message: CAMP_MESSAGES.sportEmpty };
  }
  if (values.locationCount === 0) {
    errors.locations = {
      field: 'locations',
      code: 'locationsEmpty',
      message: CAMP_MESSAGES.locationsEmpty,
    };
  }
  Object.assign(errors, ageErrors(values));
  return errors;
}

export function firstCampError(errors: Errors): CampInputError | null {
  for (const field of CAMP_FIELDS) {
    const error = errors[field];
    if (error) return error;
  }
  return null;
}

export function campAgesLabel(minimumAge: number, maximumAge: number): string {
  return minimumAge === maximumAge ? `Age ${minimumAge}` : `Ages ${minimumAge} to ${maximumAge}`;
}
