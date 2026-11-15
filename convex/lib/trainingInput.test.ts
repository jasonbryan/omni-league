import { describe, expect, test } from 'vitest';
import {
  checkTrainingFields,
  firstTrainingError,
  MAX_TRAINING_AGE,
  MAX_TRAINING_NAME_LENGTH,
  MIN_TRAINING_AGE,
  TRAINING_FIELDS,
  TRAINING_MESSAGES,
  trainingAgesLabel,
  type TrainingValues,
} from './trainingInput';

const VALID: TrainingValues = {
  name: 'Tuesday Serving Clinic',
  slug: 'tuesday-serving-clinic',
  sport: 'beachVolleyball',
  locationCount: 1,
  coachName: 'Dana Ruiz',
  minimumAge: undefined,
  maximumAge: undefined,
};

const errorsOf = (change: Partial<TrainingValues>) => checkTrainingFields({ ...VALID, ...change });

describe('checkTrainingFields', () => {
  test('accepts no ages, either bound alone, both, equal ages, and the limits of the range', () => {
    expect(errorsOf({})).toEqual({});
    expect(errorsOf({ minimumAge: 16 })).toEqual({});
    expect(errorsOf({ maximumAge: 12 })).toEqual({});
    expect(errorsOf({ minimumAge: 9, maximumAge: 14 })).toEqual({});
    expect(errorsOf({ minimumAge: 12, maximumAge: 12 })).toEqual({});
    expect(errorsOf({ minimumAge: MIN_TRAINING_AGE, maximumAge: MAX_TRAINING_AGE })).toEqual({});
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

  test.each([3, 100, 4.5, Number.NaN, -1, Infinity])('refuses %s as an age from', (age) => {
    const error = errorsOf({ minimumAge: age }).minimumAge;
    expect(error?.code).toBe('ageInvalid');
    expect(error?.message).toBe('Enter a whole number of years from 4 to 99, or leave it blank.');
  });

  test.each([3, 100, 4.5, Number.NaN, -1, Infinity])('refuses %s as an age to', (age) => {
    expect(errorsOf({ maximumAge: age }).maximumAge?.code).toBe('ageInvalid');
  });

  test('checks the order only when both ages are valid', () => {
    expect(errorsOf({ minimumAge: 3, maximumAge: 2 }).maximumAge?.code).toBe('ageInvalid');
    expect(errorsOf({ minimumAge: 3, maximumAge: 2 }).minimumAge?.code).toBe('ageInvalid');
  });

  test('refuses an empty, over-long, or hidden-character name', () => {
    expect(errorsOf({ name: '   ' }).name).toEqual({
      field: 'name',
      code: 'nameEmpty',
      message: 'Enter the training program’s name.',
    });
    expect(errorsOf({ name: 'x'.repeat(MAX_TRAINING_NAME_LENGTH + 1) }).name?.code).toBe(
      'nameTooLong',
    );
    expect(errorsOf({ name: 'a'.repeat(MAX_TRAINING_NAME_LENGTH) })).toEqual({});
    expect(errorsOf({ name: 'Clinic‮' }).name?.code).toBe('nameInvisible');
  });

  test('refuses an empty, over-long, or hidden-character coach name, and accepts 100 characters', () => {
    expect(errorsOf({ coachName: '  ' }).coachName).toEqual({
      field: 'coachName',
      code: 'coachEmpty',
      message: 'Enter the coach’s name.',
    });
    expect(errorsOf({ coachName: 'x'.repeat(101) }).coachName).toEqual({
      field: 'coachName',
      code: 'coachTooLong',
      message: 'Use 100 characters or fewer. This name has 101.',
    });
    expect(errorsOf({ coachName: 'x'.repeat(100) })).toEqual({});
    expect(errorsOf({ coachName: 'Dana‮' }).coachName?.code).toBe('coachInvisible');
  });

  test('refuses an empty, malformed, or reserved web address', () => {
    expect(errorsOf({ slug: '' }).slug?.code).toBe('slugEmpty');
    expect(errorsOf({ slug: 'Not A Slug' }).slug?.code).toBe('slugInvalid');
    expect(errorsOf({ slug: 'new' }).slug?.code).toBe('slugInvalid');
  });

  test('refuses no sport and no location', () => {
    expect(errorsOf({ sport: null }).sport?.code).toBe('sportEmpty');
    expect(errorsOf({ locationCount: 0 }).locations?.code).toBe('locationsEmpty');
  });

  test('says a taken web address with the shared wording', () => {
    expect(TRAINING_MESSAGES.slugTaken('serving')).toBe(
      'serving is already taken. Choose another web address.',
    );
  });
});

describe('firstTrainingError', () => {
  test('returns the error of the first field in page order', () => {
    const errors = errorsOf({ coachName: '', slug: '', minimumAge: 1 });
    expect(firstTrainingError(errors)?.field).toBe('slug');
    expect(firstTrainingError({})).toBeNull();
  });

  test('page order is the field order', () => {
    expect(TRAINING_FIELDS).toEqual([
      'name',
      'slug',
      'sport',
      'locations',
      'coachName',
      'minimumAge',
      'maximumAge',
    ]);
  });
});

describe('trainingAgesLabel', () => {
  test('reads each case of the ages', () => {
    expect(trainingAgesLabel(16, undefined)).toBe('16 or older');
    expect(trainingAgesLabel(undefined, 12)).toBe('12 or younger');
    expect(trainingAgesLabel(9, 14)).toBe('9 to 14');
    expect(trainingAgesLabel(12, 12)).toBe('Age 12');
    expect(trainingAgesLabel(undefined, undefined)).toBe('All ages');
  });
});
