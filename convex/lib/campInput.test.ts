import { describe, expect, test } from 'vitest';
import {
  CAMP_FIELDS,
  CAMP_MESSAGES,
  campAgesLabel,
  checkCampFields,
  firstCampError,
  MAX_CAMP_AGE,
  MAX_CAMP_NAME_LENGTH,
  MIN_CAMP_AGE,
  type CampValues,
} from './campInput';

const VALID: CampValues = {
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  sport: 'beachVolleyball',
  locationCount: 1,
  minimumAge: 9,
  maximumAge: 14,
};

const errorsOf = (change: Partial<CampValues>) => checkCampFields({ ...VALID, ...change });

describe('checkCampFields', () => {
  test('accepts valid input, equal ages, and the limits of the range', () => {
    expect(errorsOf({})).toEqual({});
    expect(errorsOf({ minimumAge: 12, maximumAge: 12 })).toEqual({});
    expect(errorsOf({ minimumAge: MIN_CAMP_AGE, maximumAge: MAX_CAMP_AGE })).toEqual({});
  });

  test('refuses an age from that is higher than the age to, under the age to', () => {
    expect(errorsOf({ minimumAge: 12, maximumAge: 9 })).toEqual({
      maximumAge: {
        field: 'maximumAge',
        code: 'agesReversed',
        message: 'The oldest age must be no lower than the youngest age, 12.',
      },
    });
  });

  test.each([3, 100, 4.5, Number.NaN, -1])('refuses %s as an age from', (age) => {
    const error = errorsOf({ minimumAge: age, maximumAge: 99 }).minimumAge;
    expect(error?.code).toBe('ageInvalid');
    expect(error?.message).toBe('Enter a whole number of years from 4 to 99.');
  });

  test.each([3, 100, 4.5, Number.NaN])('refuses %s as an age to', (age) => {
    const error = errorsOf({ minimumAge: 4, maximumAge: age }).maximumAge;
    expect(error?.code).toBe('ageInvalid');
  });

  test('says which age is missing', () => {
    expect(errorsOf({ minimumAge: undefined }).minimumAge).toEqual({
      field: 'minimumAge',
      code: 'ageEmpty',
      message: 'Enter the youngest age, from 4 to 99.',
    });
    expect(errorsOf({ maximumAge: undefined }).maximumAge).toEqual({
      field: 'maximumAge',
      code: 'ageEmpty',
      message: 'Enter the oldest age, from 4 to 99.',
    });
  });

  test('checks the order only when both ages are valid', () => {
    expect(errorsOf({ minimumAge: 3, maximumAge: 2 }).maximumAge?.code).toBe('ageInvalid');
    expect(errorsOf({ minimumAge: 3, maximumAge: 2 }).minimumAge?.code).toBe('ageInvalid');
    expect(errorsOf({ minimumAge: 12, maximumAge: undefined }).minimumAge).toBeUndefined();
  });

  test('refuses an empty, over-long, or hidden-character name', () => {
    expect(errorsOf({ name: '   ' }).name).toEqual({
      field: 'name',
      code: 'nameEmpty',
      message: 'Enter the camp’s name.',
    });
    const long = 'x'.repeat(MAX_CAMP_NAME_LENGTH + 1);
    expect(errorsOf({ name: long }).name?.code).toBe('nameTooLong');
    expect(errorsOf({ name: 'a'.repeat(MAX_CAMP_NAME_LENGTH) })).toEqual({});
    expect(errorsOf({ name: 'Camp‮' }).name?.code).toBe('nameInvisible');
  });

  test('refuses an empty, malformed, or reserved web address', () => {
    expect(errorsOf({ slug: '' }).slug?.code).toBe('slugEmpty');
    expect(errorsOf({ slug: 'Not A Slug' }).slug?.code).toBe('slugInvalid');
    expect(errorsOf({ slug: 'new' }).slug?.code).toBe('slugInvalid');
  });

  test('refuses no sport and no location', () => {
    expect(errorsOf({ sport: null }).sport).toEqual({
      field: 'sport',
      code: 'sportEmpty',
      message: 'Choose a sport.',
    });
    expect(errorsOf({ locationCount: 0 }).locations).toEqual({
      field: 'locations',
      code: 'locationsEmpty',
      message: 'Choose at least one location.',
    });
  });

  test('says a taken web address with the shared wording', () => {
    expect(CAMP_MESSAGES.slugTaken('summer-camp')).toBe(
      'summer-camp is already taken. Choose another web address.',
    );
  });
});

describe('firstCampError', () => {
  test('returns the error of the first field in page order', () => {
    const errors = errorsOf({ name: '', slug: '', minimumAge: 1 });
    expect(firstCampError(errors)?.field).toBe('name');
    expect(firstCampError({})).toBeNull();
  });

  test('page order is the field order', () => {
    expect(CAMP_FIELDS).toEqual(['name', 'slug', 'sport', 'locations', 'minimumAge', 'maximumAge']);
  });
});

describe('campAgesLabel', () => {
  test('reads the range, and one age when both are the same', () => {
    expect(campAgesLabel(9, 14)).toBe('Ages 9 to 14');
    expect(campAgesLabel(12, 12)).toBe('Age 12');
  });
});
