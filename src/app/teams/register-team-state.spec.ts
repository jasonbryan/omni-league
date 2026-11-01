import type { Id } from '../../../convex/_generated/dataModel';
import { registerTeamState, type RegistrationAnswer } from './register-team-state';

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
};
const ON_TEAM: RegistrationAnswer = {
  ...OPEN,
  team: { teamId: 'team-a' as Id<'teams'>, name: 'Sand Sharks', isCaptain: true },
};
const BEFORE_DEADLINE = Date.parse('2027-05-01T00:00:00Z');
const AFTER_DEADLINE = Date.parse('2027-05-30T00:00:00Z');

describe('registerTeamState: the first state that applies', () => {
  it.each<[string, RegistrationAnswer | undefined, boolean, number, string]>([
    ['the answer is still loading', undefined, true, BEFORE_DEADLINE, 'loading'],
    ['the season is not found, signed out', null, false, BEFORE_DEADLINE, 'not-found'],
    ['the season is not found, signed in', null, true, BEFORE_DEADLINE, 'not-found'],
    ['signed out on an open season', OPEN, false, BEFORE_DEADLINE, 'signed-out'],
    ['signed out after the deadline', OPEN, false, AFTER_DEADLINE, 'signed-out'],
    ['on a team before the deadline', ON_TEAM, true, BEFORE_DEADLINE, 'on-team'],
    ['on a team after the deadline', ON_TEAM, true, AFTER_DEADLINE, 'on-team'],
    ['on no team after the deadline', OPEN, true, AFTER_DEADLINE, 'closed'],
    ['on no team while open', OPEN, true, BEFORE_DEADLINE, 'form'],
  ])('%s: %s', (_label, answer, signedIn, nowMs, state) => {
    expect(registerTeamState({ answer, signedIn, nowMs })).toBe(state);
  });

  it('is closed from the start date when the deadline is on or after it', () => {
    const late = { ...OPEN, registrationDeadline: '2027-06-10' };
    expect(
      registerTeamState({
        answer: late,
        signedIn: true,
        nowMs: Date.parse('2027-06-06T12:00:00Z'),
      }),
    ).toBe('closed');
  });
});
