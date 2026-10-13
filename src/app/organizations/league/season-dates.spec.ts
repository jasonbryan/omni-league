import { seasonDates } from './season-dates';

describe('seasonDates', () => {
  it('writes the year once for a season inside one year', () => {
    expect(seasonDates('2027-09-08', '2027-11-10')).toBe('Sep 8 – Nov 10, 2027');
  });

  it('writes both years for a season across two', () => {
    expect(seasonDates('2027-12-01', '2028-02-20')).toBe('Dec 1, 2027 – Feb 20, 2028');
  });

  it('writes one date for a season of one day', () => {
    expect(seasonDates('2027-09-08', '2027-09-08')).toBe('Sep 8, 2027');
  });
});
