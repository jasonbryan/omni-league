import type { Id } from '../../../../convex/_generated/dataModel';
import {
  campClosedLine,
  registerCampState,
  type CampRegistrationAnswer,
} from './register-camp-state';

const SESSION = {
  sessionId: 'session-1' as Id<'campSessions'>,
  name: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  registrationDeadline: '2027-06-28',
  placesLeft: 12,
};
const OPEN: NonNullable<CampRegistrationAnswer> = {
  organizationName: 'Gulf Coast Sport & Social',
  name: 'Adult Beach Skills Camp',
  minimumAge: 18,
  maximumAge: 99,
  session: SESSION,
  registered: false,
};
const BEFORE = Date.parse('2027-06-01T00:00:00Z');
const AFTER = Date.parse('2027-06-30T00:00:00Z');

describe('registerCampState: the first state that applies', () => {
  it.each<[string, CampRegistrationAnswer | undefined, boolean, number, string]>([
    ['the answer is still loading', undefined, true, BEFORE, 'loading'],
    ['the camp is not found, signed out', null, false, BEFORE, 'not-found'],
    ['the camp is not found, signed in', null, true, BEFORE, 'not-found'],
    ['signed out on an open session', OPEN, false, BEFORE, 'signed-out'],
    ['signed out after the deadline', OPEN, false, AFTER, 'signed-out'],
    ['no session in the answer', { ...OPEN, session: null }, true, BEFORE, 'no-session'],
    ['registered before the deadline', { ...OPEN, registered: true }, true, BEFORE, 'registered'],
    ['registered after the deadline', { ...OPEN, registered: true }, true, AFTER, 'registered'],
    [
      'registered in a full session',
      { ...OPEN, registered: true, session: { ...SESSION, placesLeft: 0 } },
      true,
      BEFORE,
      'registered',
    ],
    ['after the deadline', OPEN, true, AFTER, 'closed'],
    ['on the deadline day', OPEN, true, Date.parse('2027-06-28T12:00:00Z'), 'form'],
    [
      'after the start date, before a later deadline',
      { ...OPEN, session: { ...SESSION, registrationDeadline: '2027-07-20' } },
      true,
      Date.parse('2027-07-06T12:00:00Z'),
      'closed',
    ],
    [
      'full before the deadline',
      { ...OPEN, session: { ...SESSION, placesLeft: 0 } },
      true,
      BEFORE,
      'full',
    ],
    [
      'full after the deadline',
      { ...OPEN, session: { ...SESSION, placesLeft: 0 } },
      true,
      AFTER,
      'closed',
    ],
    [
      'a camp whose maximum age is 17, after the deadline',
      { ...OPEN, minimumAge: 9, maximumAge: 17 },
      true,
      AFTER,
      'adult-not-allowed',
    ],
    [
      'a camp whose maximum age is 17',
      { ...OPEN, minimumAge: 9, maximumAge: 17 },
      true,
      BEFORE,
      'adult-not-allowed',
    ],
    [
      'a youth camp that is full',
      { ...OPEN, maximumAge: 14, session: { ...SESSION, placesLeft: 0 } },
      true,
      BEFORE,
      'adult-not-allowed',
    ],
    ['open with room', OPEN, true, BEFORE, 'form'],
  ])('%s', (_label, answer, signedIn, nowMs, expected) => {
    expect(registerCampState({ answer, signedIn, nowMs })).toBe(expected);
  });
});

describe('campClosedLine', () => {
  it('names the deadline when it passed before the session started', () => {
    expect(campClosedLine(SESSION)).toBe('It closed on Jun 28, 2027.');
  });

  it('names the start date when the deadline is on or after it', () => {
    expect(campClosedLine({ ...SESSION, registrationDeadline: '2027-07-05' })).toBe(
      'It closed when the session started on Jul 5, 2027.',
    );
  });
});
