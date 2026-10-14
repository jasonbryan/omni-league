export interface SavedTime {
  readonly text: string;
  readonly datetime: string;
}

export interface SavedTimeOptions {
  readonly locale?: string;
  readonly timeZone?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(time: number, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS;
}

function localDateTime(time: number, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(time);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const offset = part('timeZoneName').replace(/^GMT/, '') || '+00:00';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}${offset}`;
}

/** Absolute, in the device's locale and time zone, so it needs no timer and stays true. Saved copies are at most 14 days old, so the weekday and date are enough without a year. */
export function formatSavedTime(
  savedAt: number,
  now: number,
  options: SavedTimeOptions = {},
): SavedTime {
  const { locale, timeZone } = options;
  const time = new Intl.DateTimeFormat(locale, { timeZone, timeStyle: 'short' }).format(savedAt);
  const daysAgo = dayNumber(now, timeZone) - dayNumber(savedAt, timeZone);
  let day: string;
  if (daysAgo <= 0) day = 'today';
  else if (daysAgo === 1) day = 'yesterday';
  else {
    day = new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(savedAt);
  }
  return { text: `${day} at ${time}`, datetime: localDateTime(savedAt, timeZone) };
}
