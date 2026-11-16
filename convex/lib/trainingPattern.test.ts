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

const TODAY = '2026-11-15';

const errorsOf = (change: Partial<TrainingPatternValues>, today = TODAY) =>
  checkTrainingPattern({ ...VALID, ...change }, today);

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

describe('classDates across a clock change and the limits', () => {
  const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

  test('keeps the weekday through the US and EU clock changes, 7 days apart, for a full 52 weeks', () => {
    const dates = classDates('2027-01-05', 52);
    expect(dates).toHaveLength(52);
    expect(dates.every((date) => weekdayOf(date) === 2)).toBe(true);
    dates.slice(1).forEach((date, index) => {
      expect(dayNumber(date) - dayNumber(dates[index])).toBe(7);
    });
    // US spring forward is 2027-03-14 and fall back 2027-11-07; EU is 2027-03-28 and 2027-10-31.
    expect(dates).toContain('2027-03-09');
    expect(dates).toContain('2027-03-30');
    expect(dates).toContain('2027-11-02');
    expect(dates[51]).toBe('2027-12-28');
  });

  test('is strictly increasing and unique across a leap day', () => {
    const dates = classDates('2028-02-22', 4);
    expect(dates).toEqual(['2028-02-22', '2028-02-29', '2028-03-07', '2028-03-14']);
  });
});

describe('dates at the edge of the supported year range', () => {
  // 0026-11-17 is a Tuesday, 9999-12-01 a Wednesday, and 1000-01-01 a Wednesday in the proleptic Gregorian calendar.
  test('reads the weekday of a year before 100 as that year, not 19xx', () => {
    expect(weekdayOf('0026-11-17')).toBe(2);
    expect(classDates('0026-11-17', 3)).toEqual(['0026-11-17', '0026-11-24', '0026-12-01']);
  });

  test('refuses a first date in year 0026 under the first date', () => {
    const errors = errorsOf({
      weekday: 2,
      firstDate: '0026-11-17',
      registrationDeadline: '2027-01-01',
    });
    expect(errors.firstDate).toMatchObject({ field: 'firstDate' });
  });

  test('refuses 51 weeks from 9999-12-01 under the weeks, since the last class falls in year 10000', () => {
    const errors = errorsOf({
      weekday: 3,
      firstDate: '9999-12-01',
      weeks: 51,
      registrationDeadline: '9999-11-20',
    });
    expect(errors.weeks).toMatchObject({ field: 'weeks', code: 'lastClassTooLate' });
    expect(Object.keys(errors)).toEqual(['weeks']);
  });

  test('accepts the last class on 9999-12-29, and refuses one week more', () => {
    const base = { weekday: 3, firstDate: '9999-12-01', registrationDeadline: '9999-11-20' };
    expect(errorsOf({ ...base, weeks: 5 })).toEqual({});
    expect(classDates('9999-12-01', 5).at(-1)).toBe('9999-12-29');
    expect(errorsOf({ ...base, weeks: 6 }).weeks).toMatchObject({ code: 'lastClassTooLate' });
  });

  test('accepts the first supported date, 1000-01-01, and refuses the day before the range', () => {
    expect(
      errorsOf({ weekday: 3, firstDate: '1000-01-01', registrationDeadline: '1000-01-01' }),
    ).toEqual({});
    expect(
      errorsOf({ weekday: 3, firstDate: '0999-12-29', registrationDeadline: '0999-12-01' })
        .firstDate,
    ).toBeDefined();
  });

  test('refuses a weekday outside 0 to 6 or not whole, with no "undefined" in the message', () => {
    for (const weekday of [7, -1, 2.5, NaN]) {
      const error = errorsOf({ weekday }).weekday;
      expect(error).toMatchObject({ field: 'weekday', code: 'weekdayInvalid' });
      expect(error?.message).not.toContain('undefined');
    }
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

  test('refuses a first date before today under the first date, and allows today itself and later', () => {
    const TUESDAY_BEFORE_TODAY = '2026-11-10';
    const A_TUESDAY_TODAY = '2026-11-17';
    expect(
      errorsOf({ firstDate: TUESDAY_BEFORE_TODAY, registrationDeadline: '2026-11-01' }, TODAY),
    ).toEqual({
      firstDate: {
        field: 'firstDate',
        code: 'firstDateInPast',
        message: 'The first class must be today, Nov 15, 2026, or later.',
      },
    });
    expect(
      errorsOf({ firstDate: A_TUESDAY_TODAY, registrationDeadline: '2026-11-16' }, A_TUESDAY_TODAY),
    ).toEqual({});
    expect(
      errorsOf({ firstDate: A_TUESDAY_TODAY, registrationDeadline: '2026-11-16' }, '2026-11-18')
        .firstDate?.code,
    ).toBe('firstDateInPast');
    expect(
      errorsOf({ firstDate: A_TUESDAY_TODAY, registrationDeadline: '2026-11-16' }, TODAY),
    ).toEqual({});
  });

  test('reports the weekday before the past: a first date off the weekday keeps its own message', () => {
    expect(
      errorsOf({ firstDate: '2026-11-11', registrationDeadline: '2026-11-01' }).firstDate?.code,
    ).toBe('firstDateOffWeekday');
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
