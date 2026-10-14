import { formatCalendarDate } from '../../../../convex/lib/seasonInput';

/** The inputs are stored calendar dates (`YYYY-MM-DD`, no time zone), read as text, never as an instant, so the server and a browser in any time zone write the same text. */
export function seasonDateParts(
  startDate: string,
  endDate: string,
): { start: string; end: string | null } {
  const start = formatCalendarDate(startDate);
  if (startDate === endDate) return { start, end: null };
  const end = formatCalendarDate(endDate);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return { start: sameYear ? start.replace(/, \d+$/, '') : start, end };
}

export function seasonDates(startDate: string, endDate: string): string {
  const { start, end } = seasonDateParts(startDate, endDate);
  return end === null ? start : `${start} – ${end}`;
}
