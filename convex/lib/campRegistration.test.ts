import { describe, expect, test } from 'vitest';
import { adultMayRegister, ageConfirmationLabel, participantKey } from './campRegistration';

describe('participantKey', () => {
  test('is self for the account holder', () => {
    expect(participantKey({ kind: 'self' })).toBe('self');
  });

  test('is the lower-cased name for a minor, so names that differ in case are one participant', () => {
    expect(participantKey({ kind: 'minor', minorName: 'Ava Lane' })).toBe('minor:ava lane');
    expect(participantKey({ kind: 'minor', minorName: 'AVA LANE' })).toBe('minor:ava lane');
  });
});

describe('adultMayRegister', () => {
  test('is true with no maximum age or a maximum of 18 or more', () => {
    expect(adultMayRegister(undefined)).toBe(true);
    expect(adultMayRegister(18)).toBe(true);
    expect(adultMayRegister(99)).toBe(true);
  });

  test('is false with a maximum under 18', () => {
    expect(adultMayRegister(17)).toBe(false);
    expect(adultMayRegister(14)).toBe(false);
  });
});

describe('ageConfirmationLabel', () => {
  test('names the range and the start date', () => {
    expect(ageConfirmationLabel(9, 14, '2027-07-05')).toBe('I am 9 to 14 years old on Jul 5, 2027');
  });

  test('names a single age once', () => {
    expect(ageConfirmationLabel(12, 12, '2027-07-05')).toBe('I am 12 years old on Jul 5, 2027');
  });
});
