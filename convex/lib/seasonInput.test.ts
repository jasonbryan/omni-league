import { describe, expect, test } from 'vitest';
import {
  checkSeasonDates,
  checkSeasonFields,
  firstSeasonError,
  checkSeasonName,
  checkSeasonSlug,
  formatCalendarDate,
  isCalendarDate,
  SEASON_MESSAGES,
} from './seasonInput';

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

describe('checkSeasonFields and firstSeasonError', () => {
  const valid = {
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-01',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-25',
  };

  test('accepts the values of a season', () => {
    expect(checkSeasonFields(valid)).toEqual({});
    expect(firstSeasonError({})).toBeNull();
  });

  test('refuses every field that is wrong at once, and the first follows the form’s order', () => {
    const errors = checkSeasonFields({ ...valid, name: ' ', endDate: '2026-08-01' });
    expect(Object.keys(errors).sort()).toEqual(['endDate', 'name']);
    expect(firstSeasonError(errors)?.field).toBe('name');
    expect(firstSeasonError({ endDate: errors.endDate })?.field).toBe('endDate');
  });
});

describe('SEASON_MESSAGES', () => {
  test('tells the organizer where to set the format', () => {
    expect(SEASON_MESSAGES.leagueFormatMissing).toBe(
      'Set this league’s format in its details first.',
    );
  });
});
