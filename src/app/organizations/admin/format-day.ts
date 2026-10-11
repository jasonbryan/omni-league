const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A moment (ms since the epoch) as the date the staff screen shows, in the browser's time zone: `Oct 23, 2026`. */
export function formatDay(ms: number): string {
  return DAY.format(ms);
}
