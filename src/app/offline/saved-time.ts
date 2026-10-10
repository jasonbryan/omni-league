/** The saved-copy note's time: the words shown and the `<time datetime>` value. */
export interface SavedTime {
  /** "today at 6:42 PM", "yesterday at 9:14 PM", or "Thu, Oct 8 at 6:05 PM" (en-US). */
  readonly text: string;
  /** The local date and time with its UTC offset, for example `2026-10-09T21:14-05:00`. */
  readonly datetime: string;
}

export interface SavedTimeOptions {
  /** A BCP 47 locale; the device's when absent. */
  readonly locale?: string;
  /** An IANA time zone; the device's when absent. */
  readonly timeZone?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day of `time` in `timeZone`, as a day number (days since 1970-01-01). */
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

/** `YYYY-MM-DDTHH:mm±HH:MM` in `timeZone` (a valid `datetime` attribute value). */
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
  // "GMT-05:00", or "GMT" for a zero offset.
  const offset = part('timeZoneName').replace(/^GMT/, '') || '+00:00';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}${offset}`;
}

/**
 * The saved-copy note's time (#82, design/mockups/82-offline-pages.html decision 4): absolute, in
 * the device's locale and time zone, so it needs no timer and stays true. Saved copies are at most
 * 14 days old, so the weekday and date are enough without a year.
 */
export function formatSavedTime(
  savedAt: number,
  now: number,
  options: SavedTimeOptions = {},
): SavedTime {
  const { locale, timeZone } = options;
  // The locale's own short time: "6:42 PM" in en-US, "18:42" in en-GB.
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
