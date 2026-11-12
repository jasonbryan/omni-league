import { seasonRange } from './season-range';

describe('seasonRange', () => {
  it('leaves the year out of a season inside one year', () => {
    expect(seasonRange('2027-06-06', '2027-08-29')).toBe('Jun 6 – Aug 29');
  });

  it('shows both years when the season crosses a year', () => {
    expect(seasonRange('2026-12-06', '2027-02-28')).toBe('Dec 6, 2026 – Feb 28, 2027');
  });

  it('shows one date, with its year, for a season of one day', () => {
    expect(seasonRange('2027-06-06', '2027-06-06')).toBe('Jun 6, 2027');
  });

  it('reads the stored dates as written, whatever the time zone', () => {
    expect(seasonRange('2027-01-01', '2027-12-31')).toBe('Jan 1 – Dec 31');
  });
});
