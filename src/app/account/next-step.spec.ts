import { nextStep, type TeamForNextStep } from './next-step';

const NOW = Date.UTC(2027, 4, 1, 15);

function team(overrides: Partial<TeamForNextStep> = {}): TeamForNextStep {
  return {
    teamId: 'k1',
    teamName: 'Sand Sharks',
    leagueName: 'Sunday Reverse Coed 4s',
    role: 'captain',
    seasonStartDate: '2027-06-06',
    registrationDeadline: '2027-05-23',
    minimumRosterSize: 4,
    rosterCount: 3,
    ...overrides,
  };
}

describe('nextStep', () => {
  it('names a captained team below its minimum, with how many players it needs', () => {
    expect(nextStep([team()], NOW)).toEqual({
      teamId: 'k1',
      teamName: 'Sand Sharks',
      leagueName: 'Sunday Reverse Coed 4s',
      playersNeeded: 1,
      minimumRosterSize: 4,
      registrationDeadline: '2027-05-23',
    });
  });

  it('names the team with the sooner deadline when two are short', () => {
    const later = team({ teamId: 'k2', teamName: 'Aces', registrationDeadline: '2027-05-30' });
    const sooner = team({ teamId: 'k3', teamName: 'Zebras', registrationDeadline: '2027-05-20' });
    expect(nextStep([later, sooner], NOW)?.teamId).toBe('k3');
    expect(nextStep([sooner, later], NOW)?.teamId).toBe('k3');
  });

  it('names the team first by name, ignoring case, when the deadlines are equal', () => {
    const lower = team({ teamId: 'k2', teamName: 'aces' });
    const upper = team({ teamId: 'k3', teamName: 'Bears' });
    expect(nextStep([upper, lower], NOW)?.teamId).toBe('k2');
    expect(nextStep([lower, upper], NOW)?.teamId).toBe('k2');
  });

  it('names nothing when every captained team meets its minimum', () => {
    expect(nextStep([team({ rosterCount: 4 }), team({ teamId: 'k2', rosterCount: 6 })], NOW)).toBe(
      null,
    );
  });

  it('names nothing for a team the user only plays on or guards', () => {
    expect(nextStep([team({ role: 'player' }), team({ role: 'guardian' })], NOW)).toBeNull();
  });

  it('names nothing once registration has closed, and still names a team on its deadline date', () => {
    const closed = Date.UTC(2027, 4, 24, 12);
    expect(nextStep([team()], closed)).toBeNull();
    const onDeadline = Date.UTC(2027, 4, 23, 20);
    expect(nextStep([team()], onDeadline)).not.toBeNull();
  });

  it('skips a closed team and names an open one', () => {
    const closed = team({ teamId: 'k2', teamName: 'Aces', registrationDeadline: '2027-04-01' });
    expect(nextStep([closed, team()], NOW)?.teamId).toBe('k1');
  });

  it('names nothing for no teams', () => {
    expect(nextStep([], NOW)).toBeNull();
  });
});
