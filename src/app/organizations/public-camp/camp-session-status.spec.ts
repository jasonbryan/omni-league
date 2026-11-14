import { campSessionStatus } from './camp-session-status';

const SESSION = {
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  registrationDeadline: '2027-07-01',
  placesLeft: 15,
};

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string): number => Date.parse(`${date}T18:00:00Z`);

describe('campSessionStatus', () => {
  it('reads the places left and Registration open while the deadline has not passed', () => {
    expect(campSessionStatus(SESSION, at('2027-06-20'))).toEqual({
      places: '15 places left',
      badge: 'Registration open',
      badgeVariant: 'secondary',
      full: false,
    });
  });

  it('keeps registration open through the deadline day, and closes it the day after', () => {
    expect(campSessionStatus(SESSION, at('2027-07-01')).badge).toBe('Registration open');
    expect(campSessionStatus(SESSION, at('2027-07-02')).badge).toBe('Registration closed');
  });

  it('writes one place left in the singular', () => {
    expect(campSessionStatus({ ...SESSION, placesLeft: 1 }, at('2027-06-20')).places).toBe(
      '1 place left',
    );
  });

  it('reads Full at its places, with no registration badge while it is open', () => {
    expect(campSessionStatus({ ...SESSION, placesLeft: 0 }, at('2027-06-20'))).toEqual({
      places: 'Full',
      badge: null,
      badgeVariant: null,
      full: true,
    });
  });

  it('reads Registration closed rather than nothing for a full session once the deadline has passed', () => {
    expect(campSessionStatus({ ...SESSION, placesLeft: 0 }, at('2027-07-02'))).toMatchObject({
      places: 'Full',
      badge: 'Registration closed',
      badgeVariant: 'muted',
    });
  });

  it('reads In progress from the start date and Ended after the end date', () => {
    expect(campSessionStatus(SESSION, at('2027-07-05')).badge).toBe('In progress');
    expect(campSessionStatus(SESSION, at('2027-07-09')).badge).toBe('In progress');
    expect(campSessionStatus(SESSION, at('2027-07-10')).badge).toBe('Ended');
  });
});
