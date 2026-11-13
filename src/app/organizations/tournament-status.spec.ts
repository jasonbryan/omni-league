import { tournamentStatus } from './tournament-status';

const DATES = {
  startDate: '2027-05-15',
  endDate: '2027-05-16',
  registrationDeadline: '2027-05-08',
};
// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

describe('tournamentStatus', () => {
  it('is Registration open with a Register link while the tournament has room', () => {
    expect(tournamentStatus({ ...DATES, isFull: false }, at('2027-05-01'))).toMatchObject({
      badge: 'Registration open',
      badgeVariant: 'secondary',
      registrationOpen: true,
      text: 'May 15 – May 16, 2027 · closes May 8',
    });
  });

  it('is open when `isFull` is absent, as on a copy saved before it existed', () => {
    expect(tournamentStatus(DATES, at('2027-05-01')).registrationOpen).toBe(true);
  });

  it('is Full with no Register link while registration is open and the tournament is full', () => {
    expect(tournamentStatus({ ...DATES, isFull: true }, at('2027-05-01'))).toEqual({
      badge: 'Full',
      badgeVariant: 'outline',
      registrationOpen: false,
      text: 'May 15 – May 16, 2027',
    });
  });

  it('is Registration closed, not Full, once the deadline has passed', () => {
    expect(tournamentStatus({ ...DATES, isFull: true }, at('2027-05-09'))).toMatchObject({
      badge: 'Registration closed',
      registrationOpen: false,
    });
  });
});
