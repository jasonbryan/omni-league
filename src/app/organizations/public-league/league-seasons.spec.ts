import { openSeason, seasonStatus, type LeaguePageSeason } from './league-seasons';

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

describe('openSeason', () => {
  it('is the season whose registration is open', () => {
    expect(openSeason([season()], at('2027-04-01'))?.slug).toBe('summer-2027');
  });

  it('is the one with the soonest deadline when several are open', () => {
    const later = season({ slug: 'fall-2027', registrationDeadline: '2027-08-29' });
    const sooner = season({ slug: 'summer-2027', registrationDeadline: '2027-05-23' });
    expect(openSeason([later, sooner], at('2027-04-01'))?.slug).toBe('summer-2027');
  });

  it('breaks a tie of deadlines by the earlier start date', () => {
    const later = season({ slug: 'later', startDate: '2027-07-01' });
    const earlier = season({ slug: 'earlier', startDate: '2027-06-06' });
    expect(openSeason([later, earlier], at('2027-04-01'))?.slug).toBe('earlier');
  });

  it('shows the open season whatever the status of the others', () => {
    const inProgress = season({
      slug: 'current',
      startDate: '2027-03-01',
      endDate: '2027-05-30',
      registrationDeadline: '2027-02-15',
    });
    expect(openSeason([inProgress, season()], at('2027-04-01'))?.slug).toBe('summer-2027');
  });

  it('is none when every deadline has passed', () => {
    expect(openSeason([season()], at('2027-05-24'))).toBeUndefined();
  });

  it('keeps registration open through the deadline date and closes it the day after', () => {
    expect(openSeason([season()], at('2027-05-23'))).toBeDefined();
    expect(openSeason([season()], at('2027-05-24'))).toBeUndefined();
  });

  it('is none for a season that has started, whatever its deadline', () => {
    const started = season({ registrationDeadline: '2027-07-01' });
    expect(openSeason([started], at('2027-06-06'))).toBeUndefined();
  });

  it('is none without seasons, and for a copy saved before the page held them', () => {
    expect(openSeason([], at('2027-04-01'))).toBeUndefined();
    expect(openSeason(undefined, at('2027-04-01'))).toBeUndefined();
  });
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
