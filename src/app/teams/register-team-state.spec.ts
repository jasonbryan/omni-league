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
  isFull: false,
  team: null,
  freeAgent: null,
  waitlist: null,
};
const FULL: RegistrationAnswer = { ...OPEN, isFull: true, maxTeams: 2 };
const ON_TEAM: RegistrationAnswer = {
  ...OPEN,
  team: { teamId: 'team-a' as Id<'teams'>, name: 'Sand Sharks', isCaptain: true, rosterCount: 1 },
};
const REGISTERED_AT = Date.parse('2027-05-01T00:00:00Z');
const WAITING: RegistrationAnswer = {
  ...OPEN,
  freeAgent: { status: 'waiting', registeredAt: REGISTERED_AT },
};
const PLACED: RegistrationAnswer = {
  ...ON_TEAM,
  freeAgent: { status: 'placed', registeredAt: REGISTERED_AT },
};
const WAITLISTED: RegistrationAnswer = {
  ...FULL,
  waitlist: { teamName: 'Late Lobsters', position: 2 },
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
    ['a waiting free agent before the deadline', WAITING, true, BEFORE_DEADLINE, 'waiting'],
    ['a waiting free agent after the deadline', WAITING, true, AFTER_DEADLINE, 'waiting'],
    ['a placed free agent after the deadline', PLACED, true, AFTER_DEADLINE, 'on-team'],
    ['a waiting free agent, signed out', WAITING, false, AFTER_DEADLINE, 'signed-out'],
    ['on no team after the deadline', OPEN, true, AFTER_DEADLINE, 'closed'],
    ['on no team while open', OPEN, true, BEFORE_DEADLINE, 'form'],
    ['a full season while open', FULL, true, BEFORE_DEADLINE, 'full'],
    ['a waiting captain while open', WAITLISTED, true, BEFORE_DEADLINE, 'waitlisted'],
    ['a waiting captain after the deadline', WAITLISTED, true, AFTER_DEADLINE, 'waitlisted'],
    ['a waiting captain, signed out', WAITLISTED, false, AFTER_DEADLINE, 'signed-out'],
    ['a full season after the deadline', FULL, true, AFTER_DEADLINE, 'closed'],
    [
      'on a team in a full season',
      { ...FULL, team: ON_TEAM.team },
      true,
      BEFORE_DEADLINE,
      'on-team',
    ],
    [
      'a waiting free agent in a full season',
      { ...FULL, freeAgent: WAITING.freeAgent },
      true,
      BEFORE_DEADLINE,
      'waiting',
    ],
    ['a full season, signed out', FULL, false, BEFORE_DEADLINE, 'signed-out'],
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
