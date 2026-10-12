import { formatCalendarDate } from '../../../../convex/lib/seasonInput';

/**
 * A season's dates as the list shows them (design/mockups/125-126-seasons.html): `Sep 8 – Nov 10,
 * 2027` inside one year, `Dec 1, 2027 – Feb 20, 2028` across two, and one date for a one-day
 * season. The inputs are stored calendar dates (`YYYY-MM-DD`, no time zone).
 */
export function seasonDates(startDate: string, endDate: string): string {
  const start = formatCalendarDate(startDate);
  if (startDate === endDate) return start;
  const end = formatCalendarDate(endDate);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${sameYear ? start.replace(/, \d+$/, '') : start} – ${end}`;
}
