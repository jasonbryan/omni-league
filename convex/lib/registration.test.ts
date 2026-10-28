import { describe, expect, test } from 'vitest';
import {
  addCalendarDays,
  dateAtUtcMinus12,
  msUntilUtcMinus12DateChange,
  registrationIsOpen,
  seasonPhase,
} from './registration';

const SEASON = {
  registrationDeadline: '2027-05-19',
  startDate: '2027-06-02',
  endDate: '2027-08-25',
};

// 23:59 UTC-12 on a date is 11:59 UTC on the next date.
const atUtcMinus12 = (date: string, hour: number, minute: number): number => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day, hour + 12, minute);
};

describe('dateAtUtcMinus12', () => {
  test('reads the calendar date at UTC-12, so the last time zone to reach a date decides', () => {
    expect(dateAtUtcMinus12(atUtcMinus12('2027-05-19', 0, 0))).toBe('2027-05-19');
    expect(dateAtUtcMinus12(atUtcMinus12('2027-05-19', 23, 59))).toBe('2027-05-19');
    expect(dateAtUtcMinus12(atUtcMinus12('2027-05-20', 0, 0))).toBe('2027-05-20');
    expect(dateAtUtcMinus12(atUtcMinus12('2027-05-19', 0, 0) - 1)).toBe('2027-05-18');
  });
});

describe('registrationIsOpen', () => {
  test('is open through 23:59 UTC-12 on the deadline day and closed from 00:00 the next day', () => {
    expect(registrationIsOpen(SEASON, atUtcMinus12('2027-05-19', 23, 59))).toBe(true);
    expect(registrationIsOpen(SEASON, atUtcMinus12('2027-05-20', 0, 0))).toBe(false);
  });

  test('is open from the first day until the deadline', () => {
    expect(registrationIsOpen(SEASON, atUtcMinus12('2027-01-01', 0, 0))).toBe(true);
    expect(registrationIsOpen(SEASON, atUtcMinus12('2027-05-19', 0, 0))).toBe(true);
  });

  test('is closed from the start date even when the deadline is on or after it', () => {
    const late = { ...SEASON, registrationDeadline: '2027-06-02' };
    expect(registrationIsOpen(late, atUtcMinus12('2027-06-01', 23, 59))).toBe(true);
    expect(registrationIsOpen(late, atUtcMinus12('2027-06-02', 0, 0))).toBe(false);
  });
});

describe('seasonPhase', () => {
  test('moves through the four phases at the UTC-12 date changes', () => {
    expect(seasonPhase(SEASON, atUtcMinus12('2027-05-19', 23, 59))).toBe('registrationOpen');
    expect(seasonPhase(SEASON, atUtcMinus12('2027-05-20', 0, 0))).toBe('registrationClosed');
    expect(seasonPhase(SEASON, atUtcMinus12('2027-06-01', 23, 59))).toBe('registrationClosed');
    expect(seasonPhase(SEASON, atUtcMinus12('2027-06-02', 0, 0))).toBe('inProgress');
    expect(seasonPhase(SEASON, atUtcMinus12('2027-08-25', 23, 59))).toBe('inProgress');
    expect(seasonPhase(SEASON, atUtcMinus12('2027-08-26', 0, 0))).toBe('ended');
  });

  test('agrees with registrationIsOpen', () => {
    for (const date of ['2027-05-18', '2027-05-19', '2027-05-20', '2027-06-02', '2027-09-01']) {
      const now = atUtcMinus12(date, 12, 0);
      expect(seasonPhase(SEASON, now) === 'registrationOpen', date).toBe(
        registrationIsOpen(SEASON, now),
      );
    }
  });
});

describe('msUntilUtcMinus12DateChange', () => {
  test('counts to the next 12:00 UTC, when the date at UTC-12 changes', () => {
    expect(msUntilUtcMinus12DateChange(Date.UTC(2027, 4, 19, 11, 59))).toBe(60_000);
    expect(msUntilUtcMinus12DateChange(Date.UTC(2027, 4, 19, 12, 0))).toBe(24 * 60 * 60 * 1000);
    expect(msUntilUtcMinus12DateChange(Date.UTC(2027, 4, 19, 0, 0))).toBe(12 * 60 * 60 * 1000);
  });
});

describe('addCalendarDays', () => {
  test('moves a calendar date forward or back across months, years, and leap days', () => {
    expect(addCalendarDays('2026-10-27', 5)).toBe('2026-11-01');
    expect(addCalendarDays('2026-10-27', 89)).toBe('2027-01-24');
    expect(addCalendarDays('2026-10-27', -21)).toBe('2026-10-06');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addCalendarDays('2026-10-27', 0)).toBe('2026-10-27');
  });
});
