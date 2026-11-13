import { tournamentRegistrationCard } from './public-tournament-registration';
import { at, BEACH_OPEN } from './testing/tournament-data';

describe('tournamentRegistrationCard', () => {
  it('is open before the deadline, with the deadline written out', () => {
    expect(tournamentRegistrationCard(BEACH_OPEN, at('2027-04-01'))).toEqual({
      kind: 'open',
      closes: 'Jun 5, 2027',
    });
  });

  it('is open through the deadline date and closed the day after, as a season is', () => {
    expect(tournamentRegistrationCard(BEACH_OPEN, at('2027-06-05')).kind).toBe('open');
    expect(tournamentRegistrationCard(BEACH_OPEN, at('2027-06-06')).kind).toBe('closed');
  });

  it('is closed on the start date even when the deadline is that day', () => {
    const sameDay = { ...BEACH_OPEN, registrationDeadline: BEACH_OPEN.startDate };
    expect(tournamentRegistrationCard(sameDay, at('2027-06-12')).kind).toBe('closed');
  });

  it('names the deadline when closed', () => {
    expect(tournamentRegistrationCard(BEACH_OPEN, at('2027-06-20'))).toEqual({
      kind: 'closed',
      deadline: 'Jun 5, 2027',
    });
  });

  it('is full while registration is open and the tournament says it is full', () => {
    expect(tournamentRegistrationCard({ ...BEACH_OPEN, isFull: true }, at('2027-04-01'))).toEqual({
      kind: 'full',
      maximumTeams: 16,
    });
  });

  it('is open when the tournament has room, and when a saved copy made before `isFull` carries none', () => {
    expect(
      tournamentRegistrationCard({ ...BEACH_OPEN, isFull: false }, at('2027-04-01')).kind,
    ).toBe('open');
    expect(tournamentRegistrationCard(BEACH_OPEN, at('2027-04-01')).kind).toBe('open');
  });

  it('is closed, not full, once the deadline has passed', () => {
    expect(tournamentRegistrationCard({ ...BEACH_OPEN, isFull: true }, at('2027-06-06'))).toEqual({
      kind: 'closed',
      deadline: 'Jun 5, 2027',
    });
  });
});
