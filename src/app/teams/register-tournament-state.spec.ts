import type { Id } from '../../../convex/_generated/dataModel';
import {
  registerTournamentState,
  tournamentClosedLine,
  type TournamentRegistrationAnswer,
} from './register-tournament-state';

const OPEN: NonNullable<TournamentRegistrationAnswer> = {
  organizationName: 'Gulf Coast Sport & Social',
  name: 'Gulf Coast Beach Open',
  divisionLabel: 'Coed · 2v2 · Open',
  startDate: '2027-06-12',
  endDate: '2027-06-13',
  registrationDeadline: '2027-06-05',
  minimumRosterSize: 2,
  maximumTeams: 16,
  isFull: false,
  team: null,
};
const FULL: TournamentRegistrationAnswer = { ...OPEN, isFull: true };
const ON_TEAM: TournamentRegistrationAnswer = {
  ...OPEN,
  team: { teamId: 'team-a' as Id<'teams'>, name: 'Sand Crabs', isCaptain: true, rosterCount: 1 },
};
const BEFORE = Date.parse('2027-05-01T00:00:00Z');
const AFTER = Date.parse('2027-06-10T00:00:00Z');

describe('registerTournamentState: the first state that applies', () => {
  it.each<[string, TournamentRegistrationAnswer | undefined, boolean, number, string]>([
    ['the answer is still loading', undefined, true, BEFORE, 'loading'],
    ['the tournament is not found, signed out', null, false, BEFORE, 'not-found'],
    ['the tournament is not found, signed in', null, true, BEFORE, 'not-found'],
    ['signed out on an open tournament', OPEN, false, BEFORE, 'signed-out'],
    ['signed out after the deadline', OPEN, false, AFTER, 'signed-out'],
    ['on a team before the deadline', ON_TEAM, true, BEFORE, 'on-team'],
    ['on a team after the deadline', ON_TEAM, true, AFTER, 'on-team'],
    ['after the deadline', OPEN, true, AFTER, 'closed'],
    ['full before the deadline', FULL, true, BEFORE, 'full'],
    ['full after the deadline', FULL, true, AFTER, 'closed'],
    ['full and on a team', { ...FULL, team: ON_TEAM.team }, true, BEFORE, 'on-team'],
    ['open with room', OPEN, true, BEFORE, 'form'],
  ])('%s', (_label, answer, signedIn, nowMs, expected) => {
    expect(registerTournamentState({ answer, signedIn, nowMs })).toBe(expected);
  });

  it('is closed through the end of the start date even when the deadline is that day', () => {
    const sameDay = { ...OPEN, registrationDeadline: OPEN.startDate };
    expect(
      registerTournamentState({
        answer: sameDay,
        signedIn: true,
        nowMs: Date.parse('2027-06-12T18:00:00Z'),
      }),
    ).toBe('closed');
  });
});

describe('tournamentClosedLine', () => {
  it('names the deadline when it came before the start', () => {
    expect(tournamentClosedLine(OPEN)).toBe('It closed on Jun 5, 2027.');
  });

  it('names the start date when the deadline is on or after it', () => {
    expect(tournamentClosedLine({ ...OPEN, registrationDeadline: '2027-06-12' })).toBe(
      'It closed when the tournament started on Jun 12, 2027.',
    );
  });
});
