import { FULL_BADGE, MUTED_BADGE, OPEN_BADGE } from '../season-status';
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
      badgeClass: OPEN_BADGE,
      note: 'closes May 23, 2027',
    });
  });

  it('reads Registration closed between the deadline and the start', () => {
    expect(seasonStatus(row(), at('2027-05-30'))).toEqual({
      badge: 'Registration closed',
      badgeClass: MUTED_BADGE,
      note: undefined,
    });
  });

  it('reads In progress from the start date through the end date, with registration closed', () => {
    expect(seasonStatus(row(), at('2027-06-06'))).toEqual({
      badge: 'In progress',
      badgeClass: MUTED_BADGE,
      note: 'registration closed',
    });
    expect(seasonStatus(row(), at('2027-08-29'))?.badge).toBe('In progress');
  });

  it('reads Ended after the end date', () => {
    expect(seasonStatus(row(), at('2027-08-30'))).toEqual({
      badge: 'Ended',
      badgeClass: MUTED_BADGE,
      note: undefined,
    });
  });

  it('reads Full with its waitlist open for a full season whose registration is open', () => {
    expect(seasonStatus(row({ isFull: true }), at('2027-04-01'))).toEqual({
      badge: 'Full',
      badgeClass: FULL_BADGE,
      note: 'waitlist open',
    });
  });

  it('reads the phase of a full season whose registration has closed or that is in progress', () => {
    expect(seasonStatus(row({ isFull: true }), at('2027-05-30'))).toEqual({
      badge: 'Registration closed',
      badgeClass: MUTED_BADGE,
      note: undefined,
    });
    expect(seasonStatus(row({ isFull: true }), at('2027-06-06'))).toEqual({
      badge: 'In progress',
      badgeClass: MUTED_BADGE,
      note: 'registration closed',
    });
  });

  it('reads an open season with no isFull (a copy saved earlier) as Registration open', () => {
    expect(seasonStatus(row(), at('2027-04-01'))?.badge).toBe('Registration open');
    expect(seasonStatus(row({ isFull: false }), at('2027-04-01'))?.note).toBe(
      'closes May 23, 2027',
    );
  });

  it('says nothing for a row with no deadline (a copy saved before rows held it)', () => {
    expect(seasonStatus({ startDate: '2027-06-06', endDate: '2027-08-29' }, at('2027-04-01'))).toBe(
      undefined,
    );
  });
});
