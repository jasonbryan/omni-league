const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function formatDay(ms: number): string {
  return DAY.format(ms);
}
