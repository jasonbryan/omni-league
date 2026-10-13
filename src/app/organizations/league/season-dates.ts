import { formatCalendarDate } from '../../../../convex/lib/seasonInput';

/**
 * A season's dates in two parts, for a page that marks each up as a date: the start (without its
 * year inside one year) and the end (always with its year), or `null` for a season of one day. The
 * inputs are stored calendar dates (`YYYY-MM-DD`, no time zone), read as text, never as an instant,
 * so the server and a browser in any time zone write the same text.
 */
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

/**
 * A season's dates as the list shows them (design/mockups/125-126-seasons.html): `Sep 8 – Nov 10,
 * 2027` inside one year, `Dec 1, 2027 – Feb 20, 2028` across two, and one date for a one-day
 * season. The inputs are stored calendar dates (`YYYY-MM-DD`, no time zone).
 */
export function seasonDates(startDate: string, endDate: string): string {
  const { start, end } = seasonDateParts(startDate, endDate);
  return end === null ? start : `${start} – ${end}`;
}
