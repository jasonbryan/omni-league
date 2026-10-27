import { describe, expect, test } from 'vitest';
import {
  addCalendarDays,
  dateAtUtcMinus12,
  msUntilUtcMinus12DateChange,
  registrationIsOpen,
  seasonPhase,
} from './registration';

const DAY_MS = 24 * 60 * 60 * 1000;

// The date at UTC-12 changes at 12:00 UTC, so `startOf(date)` is the first millisecond of `date` there.
const startOf = (date: string): number => Date.parse(`${date}T12:00:00.000Z`);
const lastMsOf = (date: string): number => startOf(date) + DAY_MS - 1;

const SEASON = {
  registrationDeadline: '2027-05-19',
  startDate: '2027-06-02',
  endDate: '2027-08-25',
};

describe('the deadline day to the millisecond', () => {
  test('is open through its last millisecond and closed from the first of the next date', () => {
    expect(registrationIsOpen(SEASON, lastMsOf('2027-05-19'))).toBe(true);
    expect(registrationIsOpen(SEASON, startOf('2027-05-20'))).toBe(false);
    expect(seasonPhase(SEASON, lastMsOf('2027-05-19'))).toBe('registrationOpen');
    expect(seasonPhase(SEASON, startOf('2027-05-20'))).toBe('registrationClosed');
  });

  test('still reads as the deadline day in the earliest time zone, hours into the next UTC date', () => {
    // 2027-05-20 11:59 UTC is 2027-05-19 23:59 at UTC-12 and 2027-05-20 at UTC+0.
    expect(registrationIsOpen(SEASON, Date.parse('2027-05-20T11:59:59.999Z'))).toBe(true);
    expect(registrationIsOpen(SEASON, Date.parse('2027-05-20T12:00:00.000Z'))).toBe(false);
  });

  test('is already open on the first moment of the deadline day anywhere', () => {
    expect(registrationIsOpen(SEASON, startOf('2027-05-19'))).toBe(true);
    expect(registrationIsOpen(SEASON, startOf('2027-05-19') - 1)).toBe(true);
  });
});

describe('the start date', () => {
  test('ends registration at the first millisecond of the start date', () => {
    const lateDeadline = { ...SEASON, registrationDeadline: '2027-06-02' };
    expect(registrationIsOpen(lateDeadline, lastMsOf('2027-06-01'))).toBe(true);
    expect(registrationIsOpen(lateDeadline, startOf('2027-06-02'))).toBe(false);
    expect(seasonPhase(lateDeadline, lastMsOf('2027-06-01'))).toBe('registrationOpen');
    expect(seasonPhase(lateDeadline, startOf('2027-06-02'))).toBe('inProgress');
  });

  test('a deadline after the start date never keeps registration open into the season', () => {
    const afterStart = { ...SEASON, registrationDeadline: '2027-07-01' };
    expect(registrationIsOpen(afterStart, startOf('2027-06-02'))).toBe(false);
    expect(registrationIsOpen(afterStart, startOf('2027-06-15'))).toBe(false);
    expect(seasonPhase(afterStart, startOf('2027-06-15'))).toBe('inProgress');
  });

  test('a deadline on the day before the start leaves no registrationClosed day', () => {
    const dayBefore = { ...SEASON, registrationDeadline: '2027-06-01' };
    expect(seasonPhase(dayBefore, lastMsOf('2027-06-01'))).toBe('registrationOpen');
    expect(seasonPhase(dayBefore, startOf('2027-06-02'))).toBe('inProgress');
  });
});

describe('the end date', () => {
  test('is in progress through its last millisecond and ended from the first of the next date', () => {
    expect(seasonPhase(SEASON, lastMsOf('2027-08-25'))).toBe('inProgress');
    expect(seasonPhase(SEASON, startOf('2027-08-26'))).toBe('ended');
  });

  test('a one-day season is in progress on that day only', () => {
    const oneDay = { ...SEASON, startDate: '2027-06-02', endDate: '2027-06-02' };
    expect(seasonPhase(oneDay, startOf('2027-06-02'))).toBe('inProgress');
    expect(seasonPhase(oneDay, lastMsOf('2027-06-02'))).toBe('inProgress');
    expect(seasonPhase(oneDay, startOf('2027-06-03'))).toBe('ended');
  });

  test('an ended season is never open, even with a deadline in the future', () => {
    const odd = { ...SEASON, registrationDeadline: '2030-01-01' };
    expect(seasonPhase(odd, startOf('2027-09-01'))).toBe('ended');
    expect(registrationIsOpen(odd, startOf('2027-09-01'))).toBe(false);
  });
});

describe('calendar edges', () => {
  test('closes a deadline on the last day of the year in the first moments of January', () => {
    const season = { ...SEASON, registrationDeadline: '2027-12-31', startDate: '2028-02-01' };
    expect(registrationIsOpen(season, Date.parse('2028-01-01T11:59:59.999Z'))).toBe(true);
    expect(registrationIsOpen(season, Date.parse('2028-01-01T12:00:00.000Z'))).toBe(false);
  });

  test('keeps a leap-day deadline open through 29 February and not in a year without one', () => {
    const leap = { ...SEASON, registrationDeadline: '2028-02-29', startDate: '2028-04-01' };
    expect(registrationIsOpen(leap, Date.parse('2028-03-01T11:59:59.999Z'))).toBe(true);
    expect(registrationIsOpen(leap, Date.parse('2028-03-01T12:00:00.000Z'))).toBe(false);
    const common = { ...SEASON, registrationDeadline: '2027-02-28', startDate: '2027-04-01' };
    expect(registrationIsOpen(common, Date.parse('2027-03-01T11:59:59.999Z'))).toBe(true);
    expect(registrationIsOpen(common, Date.parse('2027-03-01T12:00:00.000Z'))).toBe(false);
  });

  test('moves across the dates at UTC-12 the same way in a daylight-saving week', () => {
    // US spring-forward 2027-03-14 has no effect on a UTC-based reading.
    expect(dateAtUtcMinus12(Date.parse('2027-03-14T11:59:59.999Z'))).toBe('2027-03-13');
    expect(dateAtUtcMinus12(Date.parse('2027-03-14T12:00:00.000Z'))).toBe('2027-03-14');
    expect(dateAtUtcMinus12(Date.parse('2027-03-15T11:59:59.999Z'))).toBe('2027-03-14');
  });

  test('reads dates before 1970 and far in the future without a shift', () => {
    expect(dateAtUtcMinus12(Date.parse('1969-12-31T11:59:59.999Z'))).toBe('1969-12-30');
    expect(dateAtUtcMinus12(Date.parse('1969-12-31T12:00:00.000Z'))).toBe('1969-12-31');
    expect(dateAtUtcMinus12(Date.parse('2099-12-31T12:00:00.000Z'))).toBe('2099-12-31');
  });
});

describe('msUntilUtcMinus12DateChange', () => {
  test('always lands on the first millisecond of the next date, from any moment', () => {
    const moments = [
      startOf('2027-05-19'),
      startOf('2027-05-19') + 1,
      lastMsOf('2027-05-19'),
      Date.parse('1969-12-31T00:00:00.000Z'),
      Date.parse('2099-06-15T07:08:09.010Z'),
    ];
    for (const now of moments) {
      const wait = msUntilUtcMinus12DateChange(now);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(DAY_MS);
      expect(dateAtUtcMinus12(now + wait)).toBe(addCalendarDays(dateAtUtcMinus12(now), 1));
      expect(dateAtUtcMinus12(now + wait - 1)).toBe(dateAtUtcMinus12(now));
    }
  });
});
