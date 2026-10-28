import { seasonStatus, type LeaguePageSeason } from './league-seasons';

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

const season = (overrides: Partial<LeaguePageSeason> = {}): LeaguePageSeason => ({
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  minimumRosterSize: 4,
  ...overrides,
});

describe('seasonStatus', () => {
  const row = (overrides = {}) => ({ ...season(), ...overrides });

  it('says when an open season closes, with the year', () => {
    expect(seasonStatus(row(), at('2027-04-01'))).toEqual({
      badge: 'Registration open',
      open: true,
      note: 'closes May 23, 2027',
    });
  });

  it('reads Registration closed between the deadline and the start', () => {
    expect(seasonStatus(row(), at('2027-05-30'))).toEqual({
      badge: 'Registration closed',
      open: false,
      note: undefined,
    });
  });

  it('reads In progress from the start date through the end date, with registration closed', () => {
    expect(seasonStatus(row(), at('2027-06-06'))).toEqual({
      badge: 'In progress',
      open: false,
      note: 'registration closed',
    });
    expect(seasonStatus(row(), at('2027-08-29'))?.badge).toBe('In progress');
  });

  it('reads Ended after the end date', () => {
    expect(seasonStatus(row(), at('2027-08-30'))).toEqual({
      badge: 'Ended',
      open: false,
      note: undefined,
    });
  });

  it('says nothing for a row with no deadline (a copy saved before rows held it)', () => {
    expect(seasonStatus({ startDate: '2027-06-06', endDate: '2027-08-29' }, at('2027-04-01'))).toBe(
      undefined,
    );
  });
});
