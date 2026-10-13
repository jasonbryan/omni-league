import { seasonDateParts, seasonDates } from './season-dates';

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

describe('seasonDateParts', () => {
  it('splits a season inside one year into the start without its year and the end with it', () => {
    expect(seasonDateParts('2027-06-06', '2027-08-29')).toEqual({
      start: 'Jun 6',
      end: 'Aug 29, 2027',
    });
  });

  it('splits a season across two years into two dates with their years', () => {
    expect(seasonDateParts('2027-12-01', '2028-02-20')).toEqual({
      start: 'Dec 1, 2027',
      end: 'Feb 20, 2028',
    });
  });

  it('gives one date and no end for a season of one day', () => {
    expect(seasonDateParts('2027-09-08', '2027-09-08')).toEqual({
      start: 'Sep 8, 2027',
      end: null,
    });
  });
});
