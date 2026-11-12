import { seasonDateParts } from '../organizations/league/season-dates';

const TRAILING_YEAR = /, \d+$/;

export function seasonRange(startDate: string, endDate: string): string {
  const { start, end } = seasonDateParts(startDate, endDate);
  if (end === null) return start;
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${start} – ${sameYear ? end.replace(TRAILING_YEAR, '') : end}`;
}
