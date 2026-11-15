import { describe, expect, test } from 'vitest';
import {
  checkTrainingPattern,
  classDates,
  firstTrainingPatternError,
  MAX_TRAINING_CLASS_PLACES,
  MAX_TRAINING_WEEKS,
  TRAINING_PATTERN_FIELDS,
  TRAINING_PATTERN_MESSAGES,
  trainingClassDate,
  trainingClassTimes,
  weekdayOf,
  type TrainingPatternValues,
  WEEKDAY_NAMES,
} from './trainingPattern';

const A_TUESDAY = '2027-01-05';
const TUESDAY = WEEKDAY_NAMES.indexOf('Tuesday');
const WEDNESDAY = WEEKDAY_NAMES.indexOf('Wednesday');
const LAST_YEAR_WEDNESDAY = '9999-12-01';

const VALID: TrainingPatternValues = {
  weekday: TUESDAY,
  startTime: '18:00',
  endTime: '19:00',
  firstDate: A_TUESDAY,
  weeks: 8,
  placesPerClass: 12,
  registrationDeadline: '2027-01-01',
};

const errorsOf = (change: Partial<TrainingPatternValues>) =>
  checkTrainingPattern({ ...VALID, ...change });

describe('weekdayOf and classDates', () => {
  test('reads the weekday and the dates of the years 0 to 99 as those years, not as 1900 to 1999', () => {
    expect(weekdayOf('0026-11-17')).toBe(TUESDAY);
    expect(weekdayOf('0099-01-01')).toBe(weekdayOf('0099-01-08'));
    expect(classDates('0026-11-17', 3)).toEqual(['0026-11-17', '0026-11-24', '0026-12-01']);
    expect(classDates('0099-12-25', 2)).toEqual(['0099-12-25', '0100-01-01']);
  });

  test('reads the weekday of a calendar date as text, 0 for Sunday', () => {
    expect(weekdayOf('2027-01-05')).toBe(2);
    expect(weekdayOf('2027-01-03')).toBe(0);
    expect(weekdayOf('2027-01-09')).toBe(6);
  });

  test('lists one date per week from the first date, in order, across a month and a year', () => {
    expect(classDates('2027-01-05', 8)).toEqual([
      '2027-01-05',
      '2027-01-12',
      '2027-01-19',
      '2027-01-26',
      '2027-02-02',
      '2027-02-09',
      '2027-02-16',
      '2027-02-23',
    ]);
    expect(classDates('2026-12-29', 3)).toEqual(['2026-12-29', '2027-01-05', '2027-01-12']);
    expect(classDates('2027-01-05', 1)).toEqual(['2027-01-05']);
  });
});

describe('checkTrainingPattern', () => {
  test('accepts a valid pattern, the limits, and a deadline on the first class date', () => {
    expect(errorsOf({})).toEqual({});
    expect(errorsOf({ weeks: 1, placesPerClass: 1 })).toEqual({});
    expect(
      errorsOf({ weeks: MAX_TRAINING_WEEKS, placesPerClass: MAX_TRAINING_CLASS_PLACES }),
    ).toEqual({});
    expect(errorsOf({ registrationDeadline: '2027-01-05' })).toEqual({});
  });

  test('refuses an end time that is not after the start time, under the end time', () => {
    for (const endTime of ['18:00', '17:59']) {
      expect(errorsOf({ endTime }).endTime).toEqual({
        field: 'endTime',
        code: 'endTimeNotAfterStart',
        message: 'The end time must be after the start time, 6 PM.',
      });
    }
  });

  test('says which time is missing or malformed', () => {
    expect(errorsOf({ startTime: '' }).startTime?.code).toBe('startTimeEmpty');
    expect(errorsOf({ endTime: '' }).endTime?.code).toBe('endTimeEmpty');
    expect(errorsOf({ startTime: '25:00' }).startTime?.code).toBe('timeInvalid');
    expect(errorsOf({ endTime: '9am' }).endTime?.code).toBe('timeInvalid');
  });

  test('checks the order of the times only when both are valid', () => {
    expect(errorsOf({ startTime: '25:00', endTime: '01:00' }).endTime).toBeUndefined();
  });

  test.each([0, 53, 1.5, Number.NaN, -1, Infinity])('refuses %s weeks', (weeks) => {
    expect(errorsOf({ weeks }).weeks?.code).toBe('weeksInvalid');
  });

  test.each([0, 201, 2.5, Number.NaN, -3])('refuses %s places', (placesPerClass) => {
    expect(errorsOf({ placesPerClass }).placesPerClass?.code).toBe('placesInvalid');
  });

  test.each([7, -1, 2.5, Number.NaN, Infinity])('refuses %s as a weekday', (weekday) => {
    expect(errorsOf({ weekday }).weekday).toEqual({
      field: 'weekday',
      code: 'weekdayInvalid',
      message: 'Choose a weekday from Sunday to Saturday.',
    });
    expect(errorsOf({ weekday }).firstDate).toBeUndefined();
  });

  test('says weeks, places, and the weekday are missing', () => {
    expect(errorsOf({ weeks: undefined }).weeks).toEqual({
      field: 'weeks',
      code: 'weeksEmpty',
      message: 'Enter the number of weeks, from 1 to 52.',
    });
    expect(errorsOf({ placesPerClass: undefined }).placesPerClass?.code).toBe('placesEmpty');
    expect(errorsOf({ weekday: undefined }).weekday).toEqual({
      field: 'weekday',
      code: 'weekdayEmpty',
      message: 'Choose a weekday.',
    });
  });

  test('refuses a first date that is not on the weekday, naming both', () => {
    expect(errorsOf({ firstDate: '2027-01-06' }).firstDate).toEqual({
      field: 'firstDate',
      code: 'firstDateOffWeekday',
      message: 'The first class must be on a Tuesday. Jan 6, 2027 is a Wednesday.',
    });
  });

  test('checks the first date against the weekday only when both are set', () => {
    expect(errorsOf({ weekday: undefined, firstDate: '2027-01-06' }).firstDate).toBeUndefined();
    expect(errorsOf({ firstDate: '' }).firstDate?.code).toBe('dateEmpty');
    expect(errorsOf({ firstDate: '2027-02-30' }).firstDate?.code).toBe('dateInvalid');
  });

  test('refuses a deadline after the first class, under the deadline', () => {
    expect(errorsOf({ registrationDeadline: '2027-01-06' }).registrationDeadline).toEqual({
      field: 'registrationDeadline',
      code: 'deadlineAfterFirstClass',
      message:
        'The series registration deadline must be on or before the first class, Jan 5, 2027.',
    });
    expect(errorsOf({ registrationDeadline: '' }).registrationDeadline?.code).toBe('dateEmpty');
    expect(errorsOf({ registrationDeadline: 'soon' }).registrationDeadline?.code).toBe(
      'dateInvalid',
    );
  });

  test('refuses a first date or a deadline before the year 1000, which a two-digit year typed into a date box gives', () => {
    const error = errorsOf({ firstDate: '0026-11-17' }).firstDate;
    expect(error).toEqual({
      field: 'firstDate',
      code: 'dateInvalid',
      message: 'Enter a date in a year from 1000 to 9999.',
    });
    expect(errorsOf({ firstDate: '0999-12-28' }).firstDate?.code).toBe('dateInvalid');
    expect(errorsOf({ firstDate: '1000-01-06' }).firstDate?.code).not.toBe('dateInvalid');
    expect(errorsOf({ registrationDeadline: '0026-11-17' }).registrationDeadline).toEqual({
      field: 'registrationDeadline',
      code: 'dateInvalid',
      message: 'Enter a date in a year from 1000 to 9999.',
    });
  });

  test('refuses a series whose last class falls after the year 9999, and accepts one that ends on 9999-12-31', () => {
    expect(
      errorsOf({ firstDate: LAST_YEAR_WEDNESDAY, weekday: WEDNESDAY, weeks: 51 }).weeks,
    ).toEqual({
      field: 'weeks',
      code: 'lastClassTooLate',
      message:
        'The last class would fall after the year 9999. Use fewer weeks or an earlier first date.',
    });
    expect(errorsOf({ firstDate: LAST_YEAR_WEDNESDAY, weekday: WEDNESDAY, weeks: 5 })).toEqual({});
    expect(
      errorsOf({ firstDate: LAST_YEAR_WEDNESDAY, weekday: WEDNESDAY, weeks: 6 }).weeks?.code,
    ).toBe('lastClassTooLate');
  });

  test('does not read the end of a series whose weeks are invalid', () => {
    expect(
      errorsOf({ firstDate: LAST_YEAR_WEDNESDAY, weekday: WEDNESDAY, weeks: 53 }).weeks?.code,
    ).toBe('weeksInvalid');
  });

  test('says an existing series is refused with the shared wording', () => {
    expect(TRAINING_PATTERN_MESSAGES.alreadyScheduled).toBe(
      'Classes are already scheduled for this training program.',
    );
  });
});

describe('firstTrainingPatternError', () => {
  test('returns the error of the first field in page order', () => {
    const errors = errorsOf({ weeks: 0, firstDate: '', weekday: undefined });
    expect(firstTrainingPatternError(errors)?.field).toBe('weekday');
    expect(firstTrainingPatternError({})).toBeNull();
  });

  test('page order is the field order', () => {
    expect(TRAINING_PATTERN_FIELDS).toEqual([
      'weekday',
      'startTime',
      'endTime',
      'firstDate',
      'weeks',
      'placesPerClass',
      'registrationDeadline',
    ]);
  });
});

describe('trainingClassTimes', () => {
  test('reads the times as stored', () => {
    expect(trainingClassTimes('18:00', '19:00')).toBe('6 PM to 7 PM');
    expect(trainingClassTimes('09:30', '11:15')).toBe('9:30 AM to 11:15 AM');
  });
});

describe('trainingClassDate', () => {
  test('names the weekday before the date', () => {
    expect(trainingClassDate('2027-01-05')).toBe('Tue, Jan 5, 2027');
    expect(trainingClassDate('2027-02-28')).toBe('Sun, Feb 28, 2027');
  });
});
