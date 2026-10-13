import { describe, expect, test } from 'vitest';
import { ROSTER_SIZE_INPUT_MAX } from './sports';
import {
  checkSeasonDates,
  checkSeasonFields,
  firstSeasonError,
  checkSeasonFormat,
  checkSeasonName,
  checkSeasonSlug,
  checkMinimumRosterSize,
  formatCalendarDate,
  isCalendarDate,
  parseWholeNumber,
  SEASON_MESSAGES,
} from './seasonInput';

// #125: what an organizer may type when creating a season, the rules `seasons.create` and the form
// share (design/mockups/125-126-seasons.html, "Messages and attributes").

describe('isCalendarDate', () => {
  test.each(['2026-09-01', '2028-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  test.each([
    '',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-9-1',
    '2026-09-01T00:00:00Z',
    ' 2026-09-01',
    '09/01/2026',
    '0000-01-01',
    'tomorrow',
  ])('refuses %j', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});

describe('formatCalendarDate', () => {
  test('writes a date as the lists show it, with no time zone', () => {
    expect(formatCalendarDate('2028-03-01')).toBe('Mar 1, 2028');
    expect(formatCalendarDate('2026-12-31')).toBe('Dec 31, 2026');
  });
});

describe('parseWholeNumber', () => {
  test('is null for empty text, the number for digits, and NaN for anything else', () => {
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber('   ')).toBeNull();
    expect(parseWholeNumber(' 9 ')).toBe(9);
    expect(parseWholeNumber('7.5')).toBeNaN();
    expect(parseWholeNumber('1e1')).toBeNaN();
    expect(parseWholeNumber('-3')).toBeNaN();
    expect(parseWholeNumber('seven')).toBeNaN();
  });
});

describe('checkSeasonName', () => {
  test('trims the name', () => {
    expect(checkSeasonName('  Fall 2026 ')).toEqual({ ok: true, name: 'Fall 2026' });
  });

  test('refuses an empty name and one of only spaces', () => {
    for (const name of ['', '   ']) {
      expect(checkSeasonName(name)).toEqual({
        ok: false,
        error: { field: 'name', code: 'nameEmpty', message: 'Enter the season’s name.' },
      });
    }
  });

  test('accepts 100 characters and refuses 101, naming the count', () => {
    expect(checkSeasonName('x'.repeat(100)).ok).toBe(true);
    expect(checkSeasonName('x'.repeat(101))).toEqual({
      ok: false,
      error: {
        field: 'name',
        code: 'nameTooLong',
        message: 'Use 100 characters or fewer. This name has 101.',
      },
    });
  });
});

describe('checkSeasonSlug', () => {
  test('accepts a slug and refuses an empty one', () => {
    expect(checkSeasonSlug('fall-2026')).toBeNull();
    expect(checkSeasonSlug('')).toEqual({
      field: 'slug',
      code: 'slugEmpty',
      message: 'Enter a slug for the season.',
    });
  });

  test('refuses a malformed, too short, too long, or reserved slug with the format message', () => {
    for (const slug of ['Fall 2026', 'ab', 'a'.repeat(61), '-fall', 'fall--26', 'new']) {
      expect(checkSeasonSlug(slug)).toEqual({
        field: 'slug',
        code: 'slugInvalid',
        message: SEASON_MESSAGES.slugInvalid,
      });
    }
  });
});

describe('checkSeasonDates', () => {
  const valid = {
    startDate: '2026-09-01',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-25',
  };

  test('accepts the dates of a season', () => {
    expect(checkSeasonDates(valid)).toEqual({});
  });

  test('accepts a season that starts and ends on one day', () => {
    expect(checkSeasonDates({ ...valid, endDate: valid.startDate })).toEqual({});
  });

  test('names each empty date', () => {
    expect(checkSeasonDates({ startDate: '', endDate: '', registrationDeadline: '' })).toEqual({
      startDate: { field: 'startDate', code: 'dateEmpty', message: 'Enter the start date.' },
      endDate: { field: 'endDate', code: 'dateEmpty', message: 'Enter the end date.' },
      registrationDeadline: {
        field: 'registrationDeadline',
        code: 'dateEmpty',
        message: 'Enter the registration deadline.',
      },
    });
  });

  test('refuses a date that does not exist, in any of the three fields', () => {
    for (const field of ['startDate', 'endDate', 'registrationDeadline'] as const) {
      const errors = checkSeasonDates({ ...valid, [field]: '2026-02-30' });
      expect(errors[field]).toEqual({ field, code: 'dateInvalid', message: 'Enter a real date.' });
    }
  });

  test('refuses an end before the start, on the end date', () => {
    expect(checkSeasonDates({ ...valid, endDate: '2026-08-31' })).toEqual({
      endDate: {
        field: 'endDate',
        code: 'endBeforeStart',
        message: 'The end date must be on or after the start date.',
      },
    });
  });

  test('refuses a deadline on or after the start, naming the start date', () => {
    for (const registrationDeadline of ['2026-09-01', '2026-09-02']) {
      expect(checkSeasonDates({ ...valid, registrationDeadline })).toEqual({
        registrationDeadline: {
          field: 'registrationDeadline',
          code: 'deadlineNotBeforeStart',
          message: 'The registration deadline must be before the start date, Sep 1, 2026.',
        },
      });
    }
  });

  test('compares nothing against a start date that is empty or not real', () => {
    const errors = checkSeasonDates({ ...valid, startDate: '2026-02-30' });
    expect(Object.keys(errors)).toEqual(['startDate']);
  });
});

describe('checkSeasonFormat', () => {
  test('accepts a format of the sport', () => {
    expect(checkSeasonFormat('soccer', '7v7')).toBeNull();
  });

  test('refuses no format and a format of another sport with "Choose a format."', () => {
    const refusal = { field: 'format', code: 'formatInvalid', message: 'Choose a format.' };
    expect(checkSeasonFormat('soccer', null)).toEqual(refusal);
    expect(checkSeasonFormat('soccer', '4v4')).toEqual(refusal);
    expect(checkSeasonFormat('soccer', '3v3')).toEqual(refusal);
  });
});

describe('checkMinimumRosterSize', () => {
  test('accepts the format minimum, a raised one, and the largest input', () => {
    for (const value of [7, 9, ROSTER_SIZE_INPUT_MAX]) {
      expect(checkMinimumRosterSize('soccer', '7v7', value)).toBeNull();
    }
  });

  test('refuses an empty value with no format needed', () => {
    expect(checkMinimumRosterSize('soccer', null, null)).toEqual({
      field: 'minimumRosterSize',
      code: 'minimumEmpty',
      message: 'Enter the minimum roster size.',
    });
  });

  test('refuses a value below the format minimum, naming the format and the minimum', () => {
    expect(checkMinimumRosterSize('soccer', '7v7', 6)).toEqual({
      field: 'minimumRosterSize',
      code: 'minimumBelowFormat',
      message: '7v7 needs at least 7 players. Enter 7 or more.',
    });
  });

  test('refuses 100, 7.5, and NaN with the range', () => {
    for (const value of [100, 7.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkMinimumRosterSize('soccer', '7v7', value)).toEqual({
        field: 'minimumRosterSize',
        code: 'minimumOutOfRange',
        message: 'Enter a whole number from 7 to 99.',
      });
    }
  });

  test('with no format chosen, a whole number in 1 to 99 passes and anything else is out of range', () => {
    expect(checkMinimumRosterSize('soccer', null, 5)).toBeNull();
    expect(checkMinimumRosterSize('soccer', null, 100)?.message).toBe(
      'Enter a whole number from 1 to 99.',
    );
  });
});

describe('checkSeasonFields and firstSeasonError', () => {
  const valid = {
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-01',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-25',
    format: '7v7',
    minimumRosterSize: 7,
  };

  test('accepts the values of a season', () => {
    expect(checkSeasonFields('soccer', valid)).toEqual({});
    expect(firstSeasonError({})).toBeNull();
  });

  test('refuses every field that is wrong at once, and the first follows the form’s order', () => {
    const errors = checkSeasonFields('soccer', {
      ...valid,
      name: ' ',
      endDate: '2026-08-01',
      minimumRosterSize: 6,
    });
    expect(Object.keys(errors).sort()).toEqual(['endDate', 'minimumRosterSize', 'name']);
    expect(firstSeasonError(errors)?.field).toBe('name');
    expect(firstSeasonError({ minimumRosterSize: errors.minimumRosterSize })?.field).toBe(
      'minimumRosterSize',
    );
  });

  test('checks the minimum against the format chosen', () => {
    expect(
      checkSeasonFields('soccer', { ...valid, format: '11v11' }).minimumRosterSize?.message,
    ).toBe('11v11 needs at least 11 players. Enter 11 or more.');
    expect(checkSeasonFields('soccer', { ...valid, format: null }).format?.message).toBe(
      'Choose a format.',
    );
  });
});
