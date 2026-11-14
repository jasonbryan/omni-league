import { describe, expect, test } from 'vitest';
import {
  CAMP_SESSION_FIELDS,
  CAMP_SESSION_MESSAGES,
  MAX_CAMP_SESSION_NAME_LENGTH,
  MAX_CAMP_SESSION_PLACES,
  campSessionTimes,
  checkCampSessionFields,
  firstCampSessionError,
  formatDailyTime,
  type CampSessionValues,
} from './campSessionInput';

const VALID: CampSessionValues = {
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places: 20,
  registrationDeadline: '2027-07-01',
};

const errorsOf = (change: Partial<CampSessionValues>) =>
  checkCampSessionFields({ ...VALID, ...change });

describe('checkCampSessionFields', () => {
  test('accepts valid input, a one-day session, a deadline on the start date, and no times', () => {
    expect(errorsOf({})).toEqual({});
    expect(errorsOf({ endDate: '2027-07-05' })).toEqual({});
    expect(errorsOf({ registrationDeadline: '2027-07-05' })).toEqual({});
    expect(errorsOf({ dailyStartTime: undefined, dailyEndTime: undefined })).toEqual({});
  });

  test('refuses an end date before the start date, under the end date', () => {
    expect(errorsOf({ endDate: '2027-07-04' })).toEqual({
      endDate: {
        field: 'endDate',
        code: 'endBeforeStart',
        message: 'The end date must be on or after the start date.',
      },
    });
  });

  test('refuses a deadline after the start date, under the deadline, naming the start date', () => {
    expect(errorsOf({ registrationDeadline: '2027-07-06' })).toEqual({
      registrationDeadline: {
        field: 'registrationDeadline',
        code: 'deadlineAfterStart',
        message: 'The registration deadline must be on or before the start date, Jul 5, 2027.',
      },
    });
  });

  test('says which date is missing, and refuses one that is not a real date', () => {
    expect(errorsOf({ startDate: '' }).startDate?.message).toBe('Enter the start date.');
    expect(errorsOf({ endDate: '' }).endDate?.message).toBe('Enter the end date.');
    expect(errorsOf({ registrationDeadline: '' }).registrationDeadline?.message).toBe(
      'Enter the registration deadline.',
    );
    expect(errorsOf({ startDate: '2027-02-30' }).startDate).toEqual({
      field: 'startDate',
      code: 'dateInvalid',
      message: 'Enter a real date.',
    });
  });

  test('does not compare dates with one that is missing or not real', () => {
    const errors = errorsOf({ startDate: '', endDate: '2027-07-04', registrationDeadline: '' });
    expect(Object.keys(errors).sort()).toEqual(['registrationDeadline', 'startDate']);
  });

  test.each([
    ['empty', '', 'nameEmpty'],
    ['whitespace', '   ', 'nameEmpty'],
    ['zero-width characters', '​​', 'nameEmpty'],
    ['over the limit', 'x'.repeat(MAX_CAMP_SESSION_NAME_LENGTH + 1), 'nameTooLong'],
    ['a control character', 'Week\u00001', 'nameInvisible'],
  ])('refuses a name that is %s', (_label, name, code) => {
    expect(errorsOf({ name }).name?.code).toBe(code);
  });

  test('accepts a name at the limit and measures the trimmed name', () => {
    expect(errorsOf({ name: 'x'.repeat(MAX_CAMP_SESSION_NAME_LENGTH) })).toEqual({});
    expect(errorsOf({ name: ` ${'x'.repeat(MAX_CAMP_SESSION_NAME_LENGTH)} ` })).toEqual({});
    expect(errorsOf({ name: 'x'.repeat(101) }).name?.message).toBe(
      'Use 100 characters or fewer. This name has 101.',
    );
  });

  test.each([1, 20, MAX_CAMP_SESSION_PLACES])('accepts %s places', (places) => {
    expect(errorsOf({ places })).toEqual({});
  });

  test.each([0, 501, -1, 2.5, Number.NaN, Infinity])('refuses %s places', (places) => {
    expect(errorsOf({ places }).places).toEqual({
      field: 'places',
      code: 'placesInvalid',
      message: 'Enter a whole number of places from 1 to 500.',
    });
  });

  test('says when the places are missing', () => {
    expect(errorsOf({ places: undefined }).places).toEqual({
      field: 'places',
      code: 'placesEmpty',
      message: 'Enter the number of places, from 1 to 500.',
    });
  });

  test('takes times as stored, 24-hour HH:MM, and refuses text that is not a time', () => {
    expect(errorsOf({ dailyStartTime: '00:00', dailyEndTime: '23:59' })).toEqual({});
    for (const time of ['9:00', '24:00', '12:60', '09:00:00', 'noon', '09.00']) {
      expect(errorsOf({ dailyStartTime: time }).dailyStartTime?.code, time).toBe('timeInvalid');
      expect(errorsOf({ dailyEndTime: time }).dailyEndTime?.code, time).toBe('timeInvalid');
    }
  });

  test('asks for the other time when only one is given, under the missing one', () => {
    expect(errorsOf({ dailyEndTime: undefined }).dailyEndTime).toEqual({
      field: 'dailyEndTime',
      code: 'timeMissing',
      message: 'Enter the end time, or clear the start time.',
    });
    expect(errorsOf({ dailyStartTime: undefined }).dailyStartTime).toEqual({
      field: 'dailyStartTime',
      code: 'timeMissing',
      message: 'Enter the start time, or clear the end time.',
    });
  });

  test('refuses an end time that is not after the start time, under the end time', () => {
    for (const dailyEndTime of ['09:00', '08:59']) {
      expect(errorsOf({ dailyEndTime }).dailyEndTime).toEqual({
        field: 'dailyEndTime',
        code: 'endTimeNotAfterStart',
        message: 'The end time must be after the start time, 9 AM.',
      });
    }
  });

  test('reports a time that is not valid before comparing it', () => {
    expect(errorsOf({ dailyStartTime: 'noon', dailyEndTime: '08:00' })).toEqual({
      dailyStartTime: {
        field: 'dailyStartTime',
        code: 'timeInvalid',
        message: CAMP_SESSION_MESSAGES.timeInvalid,
      },
    });
  });
});

describe('firstCampSessionError', () => {
  test('returns the error of the first field in the order of the page', () => {
    const errors = errorsOf({ places: 0, registrationDeadline: '2027-08-01' });
    expect(firstCampSessionError(errors)?.field).toBe('registrationDeadline');
    expect(firstCampSessionError(errorsOf({ name: '', places: 0 }))?.field).toBe('name');
    expect(CAMP_SESSION_FIELDS).toEqual([
      'name',
      'startDate',
      'endDate',
      'registrationDeadline',
      'dailyStartTime',
      'dailyEndTime',
      'places',
    ]);
    expect(firstCampSessionError({})).toBeNull();
  });
});

describe('formatDailyTime', () => {
  test.each([
    ['00:00', '12 AM'],
    ['09:00', '9 AM'],
    ['09:30', '9:30 AM'],
    ['12:00', '12 PM'],
    ['12:05', '12:05 PM'],
    ['13:45', '1:45 PM'],
    ['23:59', '11:59 PM'],
  ])('shows %s as %s, with no time zone', (stored, shown) => {
    expect(formatDailyTime(stored)).toBe(shown);
  });
});

describe('campSessionTimes', () => {
  test('joins the two times, and is empty when the session has none', () => {
    expect(campSessionTimes('09:00', '12:00')).toBe('9 AM to 12 PM');
    expect(campSessionTimes('08:30', '15:15')).toBe('8:30 AM to 3:15 PM');
    expect(campSessionTimes(undefined, undefined)).toBeNull();
  });
});
