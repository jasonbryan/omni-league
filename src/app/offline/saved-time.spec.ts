import { formatSavedTime } from './saved-time';

/** Intl puts a narrow no-break space before AM/PM in current ICU data; compare with plain spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ');

const CHICAGO = { locale: 'en-US', timeZone: 'America/Chicago' };
const NOW = Date.UTC(2026, 9, 10, 14, 30);

describe('formatSavedTime', () => {
  it('reads "today at <time>" for a time earlier the same day', () => {
    const saved = formatSavedTime(Date.UTC(2026, 9, 10, 5, 42), NOW, CHICAGO);
    expect(plain(saved.text)).toBe('today at 12:42 AM');
    expect(saved.datetime).toBe('2026-10-10T00:42-05:00');
  });

  it('reads "yesterday at <time>" for the day before, even under 24 hours ago', () => {
    const saved = formatSavedTime(Date.UTC(2026, 9, 10, 2, 14), NOW, CHICAGO);
    expect(plain(saved.text)).toBe('yesterday at 9:14 PM');
    expect(saved.datetime).toBe('2026-10-09T21:14-05:00');
  });

  it('reads "<weekday>, <month> <day> at <time>" from 2 to 14 days ago', () => {
    const twoDays = formatSavedTime(Date.UTC(2026, 9, 8, 23, 5), NOW, CHICAGO);
    expect(plain(twoDays.text)).toBe('Thu, Oct 8 at 6:05 PM');
    expect(twoDays.datetime).toBe('2026-10-08T18:05-05:00');

    const fourteen = formatSavedTime(Date.UTC(2026, 8, 26, 17, 0), NOW, CHICAGO);
    expect(plain(fourteen.text)).toBe('Sat, Sep 26 at 12:00 PM');
  });

  it('counts days in the given time zone, not UTC', () => {
    // 03:30 UTC on Oct 10 is still Oct 9 in Chicago (yesterday) but Oct 10 in UTC (today).
    const saved = Date.UTC(2026, 9, 10, 3, 30);
    expect(plain(formatSavedTime(saved, NOW, CHICAGO).text)).toBe('yesterday at 10:30 PM');
    expect(plain(formatSavedTime(saved, NOW, { locale: 'en-US', timeZone: 'UTC' }).text)).toBe(
      'today at 3:30 AM',
    );
    expect(formatSavedTime(saved, NOW, { locale: 'en-US', timeZone: 'UTC' }).datetime).toBe(
      '2026-10-10T03:30+00:00',
    );
  });

  it('formats the time and date in the given locale', () => {
    const saved = formatSavedTime(Date.UTC(2026, 9, 8, 23, 5), NOW, {
      locale: 'en-GB',
      timeZone: 'Europe/London',
    });
    // Oct 9, 00:05 BST is yesterday in London.
    expect(plain(saved.text)).toBe('yesterday at 00:05');
    expect(saved.datetime).toBe('2026-10-09T00:05+01:00');
  });

  it('treats a saved time later than now (a clock change) as today', () => {
    const saved = formatSavedTime(NOW + 60_000, NOW, CHICAGO);
    expect(plain(saved.text)).toBe('today at 9:31 AM');
  });

  it("defaults to the device's locale and time zone", () => {
    const device = Intl.DateTimeFormat().resolvedOptions();
    expect(formatSavedTime(NOW - 60_000, NOW)).toEqual(
      formatSavedTime(NOW - 60_000, NOW, { locale: device.locale, timeZone: device.timeZone }),
    );
  });
});
