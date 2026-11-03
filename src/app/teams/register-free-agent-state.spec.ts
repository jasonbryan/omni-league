import type { Id } from '../../../convex/_generated/dataModel';
import { registerFreeAgentState } from './register-free-agent-state';
import type { RegistrationAnswer } from './register-team-state';

const OPEN: NonNullable<RegistrationAnswer> = {
  organizationName: 'Gulf Coast Sport & Social',
  leagueName: 'Sunday Reverse Coed 4s',
  seasonName: 'Summer 2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  formatName: '4v4',
  minimumRosterSize: 4,
  team: null,
  freeAgent: null,
};
const TEAM = {
  teamId: 'team-a' as Id<'teams'>,
  name: 'Sand Sharks',
  isCaptain: false,
  rosterCount: 4,
};
const WAITING: RegistrationAnswer = {
  ...OPEN,
  freeAgent: { status: 'waiting', registeredAt: Date.parse('2027-05-01T00:00:00Z') },
};
const PLACED: RegistrationAnswer = {
  ...OPEN,
  team: TEAM,
  freeAgent: { status: 'placed', registeredAt: Date.parse('2027-05-01T00:00:00Z') },
};
const ON_TEAM: RegistrationAnswer = { ...OPEN, team: TEAM };
const BEFORE_DEADLINE = Date.parse('2027-05-10T00:00:00Z');
const AFTER_DEADLINE = Date.parse('2027-05-30T00:00:00Z');

describe('registerFreeAgentState: the first state that applies', () => {
  it.each<[string, RegistrationAnswer | undefined, boolean, number, string]>([
    ['the answer is still loading', undefined, true, AFTER_DEADLINE, 'loading'],
    ['the season is not found', null, true, AFTER_DEADLINE, 'not-found'],
    ['signed out', OPEN, false, AFTER_DEADLINE, 'signed-out'],
    ['rostered on a team', ON_TEAM, true, AFTER_DEADLINE, 'on-team'],
    ['a placed free agent', PLACED, true, AFTER_DEADLINE, 'on-team'],
    ['a waiting free agent', WAITING, true, AFTER_DEADLINE, 'waiting'],
    ['neither', OPEN, true, AFTER_DEADLINE, 'closed'],
  ])('past the deadline, %s', (_label, answer, signedIn, nowMs, state) => {
    expect(registerFreeAgentState({ answer, signedIn, nowMs })).toBe(state);
  });

  it.each<[string, RegistrationAnswer, string]>([
    ['a waiting free agent', WAITING, 'waiting'],
    ['a placed free agent', PLACED, 'on-team'],
    ['neither', OPEN, 'form'],
  ])('while open, %s', (_label, answer, state) => {
    expect(registerFreeAgentState({ answer, signedIn: true, nowMs: BEFORE_DEADLINE })).toBe(state);
  });

  it('signed out, a waiting answer still goes to sign-in', () => {
    expect(
      registerFreeAgentState({ answer: WAITING, signedIn: false, nowMs: AFTER_DEADLINE }),
    ).toBe('signed-out');
  });
});
