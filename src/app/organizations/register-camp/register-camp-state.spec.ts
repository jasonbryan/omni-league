import type { Id } from '../../../../convex/_generated/dataModel';
import {
  campClosedLine,
  registerCampState,
  registrationOptions,
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
  waitlisted: false,
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
      'waitlist',
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
      'closed',
    ],
    [
      'a camp whose maximum age is 17 offers the form, for a child',
      { ...OPEN, minimumAge: 9, maximumAge: 17 },
      true,
      BEFORE,
      'form',
    ],
    [
      'a youth camp that is full',
      { ...OPEN, minimumAge: 9, maximumAge: 14, session: { ...SESSION, placesLeft: 0 } },
      true,
      BEFORE,
      'waitlist',
    ],
    [
      'registered for a camp that admits a child, the form for a child',
      { ...OPEN, minimumAge: 14, maximumAge: 30, registered: true },
      true,
      BEFORE,
      'form',
    ],
    [
      'registered for a camp that admits a child, after the deadline',
      { ...OPEN, minimumAge: 14, maximumAge: 30, registered: true },
      true,
      AFTER,
      'registered',
    ],
    [
      'registered for a camp that admits a child, in a full session: the waitlist for a child',
      {
        ...OPEN,
        minimumAge: 14,
        maximumAge: 30,
        registered: true,
        session: { ...SESSION, placesLeft: 0 },
      },
      true,
      BEFORE,
      'waitlist',
    ],
    [
      'waiting for a place, in a full session',
      { ...OPEN, waitlisted: true, session: { ...SESSION, placesLeft: 0 } },
      true,
      BEFORE,
      'waitlisted',
    ],
    [
      'waiting for a place, after the deadline',
      { ...OPEN, waitlisted: true, session: { ...SESSION, placesLeft: 0 } },
      true,
      AFTER,
      'waitlisted',
    ],
    [
      'waiting for a place in a camp that admits a child, in a full session: the waitlist for a child',
      {
        ...OPEN,
        minimumAge: 14,
        maximumAge: 30,
        waitlisted: true,
        session: { ...SESSION, placesLeft: 0 },
      },
      true,
      BEFORE,
      'waitlist',
    ],
    [
      'registered and waiting for a child, once the session closes',
      {
        ...OPEN,
        minimumAge: 14,
        maximumAge: 30,
        registered: true,
        session: { ...SESSION, placesLeft: 0 },
      },
      true,
      AFTER,
      'registered',
    ],
    [
      'ages no one may register for, unregistered',
      { ...OPEN, minimumAge: 20, maximumAge: 15 },
      true,
      BEFORE,
      'adult-not-allowed',
    ],
    ['open with room', OPEN, true, BEFORE, 'form'],
  ])('%s', (_label, answer, signedIn, nowMs, expected) => {
    expect(registerCampState({ answer, signedIn, nowMs })).toBe(expected);
  });
});

describe('registrationOptions: who the form offers', () => {
  it.each<[string, Partial<NonNullable<CampRegistrationAnswer>>, string[]]>([
    ['an adult camp: only the adult', {}, ['self']],
    ['a youth camp: only a child', { minimumAge: 9, maximumAge: 17 }, ['minor']],
    ['ages that span 18: both', { minimumAge: 14, maximumAge: 30 }, ['self', 'minor']],
    [
      'both, the adult already registered: only a child',
      { minimumAge: 14, maximumAge: 30, registered: true },
      ['minor'],
    ],
    ['an adult camp, the adult registered: none', { registered: true }, []],
    ['an adult camp, the adult waiting: none', { waitlisted: true }, []],
    [
      'both, the adult waiting: only a child',
      { minimumAge: 14, maximumAge: 30, waitlisted: true },
      ['minor'],
    ],
  ])('%s', (_label, over, expected) => {
    expect(registrationOptions({ ...OPEN, ...over })).toEqual(expected);
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
