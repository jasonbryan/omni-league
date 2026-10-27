// Imports nothing from the server, so the app and the functions share one rule.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// The last time zone to reach a date, so a deadline stays open until its date has ended everywhere.
const UTC_MINUS_12_MS = 12 * HOUR_MS;

export type SeasonPhase = 'registrationOpen' | 'registrationClosed' | 'inProgress' | 'ended';

export interface SeasonDates {
  startDate: string;
  endDate: string;
  registrationDeadline: string;
}

export function dateAtUtcMinus12(nowMs: number): string {
  return new Date(nowMs - UTC_MINUS_12_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function msUntilUtcMinus12DateChange(nowMs: number): number {
  const sinceDateStart = (((nowMs - UTC_MINUS_12_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - sinceDateStart;
}

/** Stored dates are calendar dates, so the comparisons are between `YYYY-MM-DD` texts. */
export function seasonPhase(season: SeasonDates, nowMs: number): SeasonPhase {
  const today = dateAtUtcMinus12(nowMs);
  if (today < season.startDate) {
    return today <= season.registrationDeadline ? 'registrationOpen' : 'registrationClosed';
  }
  return today <= season.endDate ? 'inProgress' : 'ended';
}

export function registrationIsOpen(
  season: Pick<SeasonDates, 'registrationDeadline' | 'startDate'>,
  nowMs: number,
): boolean {
  const today = dateAtUtcMinus12(nowMs);
  return today <= season.registrationDeadline && today < season.startDate;
}
