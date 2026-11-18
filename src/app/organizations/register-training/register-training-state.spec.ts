import {
  registerTrainingState,
  registrationOptions,
  trainingClosedLine,
  type TrainingRegistrationAnswer,
} from './register-training-state';

type Answer = NonNullable<TrainingRegistrationAnswer>;

const OPEN: Answer = {
  trainingId: 'training_1' as Answer['trainingId'],
  organizationName: 'Gulf Coast Sport & Social',
  name: 'Tuesday Serving Clinic',
  pattern: {
    weekday: 2,
    startTime: '18:00',
    endTime: '19:00',
    firstDate: '2027-02-02',
    weeks: 3,
    registrationDeadline: '2027-02-01',
  },
  classCount: 3,
  placesLeft: 12,
  registered: false,
};
const NOON = Date.parse('2027-02-01T12:00:00Z');

const state = (answer: Parameters<typeof registerTrainingState>[0]['answer'], over = {}) =>
  registerTrainingState({ answer, signedIn: true, nowMs: NOON, ...over });

describe('registrationOptions', () => {
  it('offers both for a program with no ages', () => {
    expect(registrationOptions(OPEN)).toEqual(['self', 'minor']);
  });

  it('offers only a child when the maximum age is under 18', () => {
    expect(registrationOptions({ ...OPEN, maximumAge: 17 })).toEqual(['minor']);
  });

  it('offers only the account holder when the minimum age is 18 or more', () => {
    expect(registrationOptions({ ...OPEN, minimumAge: 18 })).toEqual(['self']);
  });

  it('leaves out the account holder once they hold a place', () => {
    expect(registrationOptions({ ...OPEN, registered: true })).toEqual(['minor']);
  });
});

describe('registerTrainingState', () => {
  it('is loading before the answer, not found for null, and signed out for a visitor', () => {
    expect(state(undefined)).toBe('loading');
    expect(state(null)).toBe('not-found');
    expect(state(OPEN, { signedIn: false })).toBe('signed-out');
  });

  it('is the form while open, and also on the deadline day', () => {
    expect(state(OPEN)).toBe('form');
    expect(state(OPEN, { nowMs: Date.parse('2027-02-01T23:00:00Z') })).toBe('form');
  });

  it('is closed after the deadline and with no class left to attend', () => {
    expect(state(OPEN, { nowMs: Date.parse('2027-02-03T12:00:00Z') })).toBe('closed');
    expect(state({ ...OPEN, classCount: 0 })).toBe('closed');
  });

  it('is full while any class has no place', () => {
    expect(state({ ...OPEN, placesLeft: 0, fullClassDate: '2027-02-09' })).toBe('full');
  });

  it('is registered once nothing else can be asked for, even after the deadline', () => {
    const held = { ...OPEN, minimumAge: 18, registered: true };
    expect(state(held)).toBe('registered');
    expect(state(held, { nowMs: Date.parse('2027-02-03T12:00:00Z') })).toBe('registered');
    expect(
      state({
        ...OPEN,
        registered: true,
        placesLeft: 0,
        fullClassDate: '2027-02-09',
        minimumAge: 18,
      }),
    ).toBe('registered');
  });

  it('is registered after the deadline for a guardian who could still register a child', () => {
    expect(
      state({ ...OPEN, registered: true }, { nowMs: Date.parse('2027-02-03T12:00:00Z') }),
    ).toBe('registered');
  });

  it('keeps the form for a registered account holder who can still register a child', () => {
    expect(state({ ...OPEN, registered: true })).toBe('form');
  });
});

describe('trainingClosedLine', () => {
  it('names the deadline once it has passed', () => {
    expect(trainingClosedLine(OPEN, Date.parse('2027-02-03T12:00:00Z'))).toBe(
      'It closed on Feb 1, 2027.',
    );
  });

  it('says no class is left to attend while the deadline has not passed', () => {
    expect(trainingClosedLine({ ...OPEN, classCount: 0 }, NOON)).toBe(
      'Every class has passed or is cancelled.',
    );
  });
});
