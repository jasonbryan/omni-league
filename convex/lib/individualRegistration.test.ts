import { describe, expect, test } from 'vitest';
import {
  MAX_MINORS_PER_SESSION,
  adultMayRegister,
  ageConfirmationLabel,
  childNameError,
  ageNotConfirmedMessage,
  minorMayRegister,
  participantKey,
  participantsOffered,
} from './individualRegistration';
import { checkMinorName } from './minorName';

describe('participantKey', () => {
  test('is self for the account holder', () => {
    expect(participantKey({ kind: 'self' })).toBe('self');
  });

  test('is the lower-cased name for a minor, so names that differ in case are one participant', () => {
    expect(participantKey({ kind: 'minor', minorName: 'Ava Lane' })).toBe('minor:ava lane');
    expect(participantKey({ kind: 'minor', minorName: 'AVA LANE' })).toBe('minor:ava lane');
  });

  test('collapses spacing, so names that differ in spacing are one participant', () => {
    expect(participantKey({ kind: 'minor', minorName: '  Ava   Lane ' })).toBe('minor:ava lane');
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

describe('minorMayRegister', () => {
  test('is true with no minimum age or a minimum under 18', () => {
    expect(minorMayRegister(undefined)).toBe(true);
    expect(minorMayRegister(0)).toBe(true);
    expect(minorMayRegister(9)).toBe(true);
    expect(minorMayRegister(17)).toBe(true);
  });

  test('is false with a minimum of 18 or more, which a minor cannot truthfully confirm', () => {
    expect(minorMayRegister(18)).toBe(false);
    expect(minorMayRegister(30)).toBe(false);
  });
});

describe('participantsOffered', () => {
  test('offers both for ages that span 17 and 18', () => {
    expect(participantsOffered({ minimumAge: 14, maximumAge: 30 })).toEqual(['self', 'minor']);
  });

  test('offers only a child for a youth camp', () => {
    expect(participantsOffered({ minimumAge: 9, maximumAge: 17 })).toEqual(['minor']);
  });

  test('offers only the adult for a camp from 18', () => {
    expect(participantsOffered({ minimumAge: 18, maximumAge: 99 })).toEqual(['self']);
  });
});

describe('ageConfirmationLabel', () => {
  const SELF = { kind: 'self' } as const;
  const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;

  test('names the range and the start date', () => {
    expect(ageConfirmationLabel(SELF, 9, 14, '2027-07-05')).toBe(
      'I am 9 to 14 years old on Jul 5, 2027',
    );
  });

  test('names a single age once', () => {
    expect(ageConfirmationLabel(SELF, 12, 12, '2027-07-05')).toBe(
      'I am 12 years old on Jul 5, 2027',
    );
  });

  test('names the child for a minor', () => {
    expect(ageConfirmationLabel(MAYA, 9, 14, '2027-07-05')).toBe(
      'Maya R. is 9 to 14 years old on Jul 5, 2027.',
    );
    expect(ageConfirmationLabel(MAYA, 12, 12, '2027-07-05')).toBe(
      'Maya R. is 12 years old on Jul 5, 2027.',
    );
  });

  test('says the child before a name is entered', () => {
    expect(ageConfirmationLabel({ kind: 'minor', minorName: '' }, 9, 14, '2027-07-05')).toBe(
      'My child is 9 to 14 years old on Jul 5, 2027.',
    );
  });

  test('says "or older" for a program with only a minimum age', () => {
    expect(ageConfirmationLabel(SELF, 16, undefined, '2027-07-05')).toBe(
      'I am 16 or older on Jul 5, 2027',
    );
    expect(ageConfirmationLabel(MAYA, 16, undefined, '2027-07-05')).toBe(
      'Maya R. is 16 or older on Jul 5, 2027.',
    );
  });

  test('says "or younger" for a program with only a maximum age', () => {
    expect(ageConfirmationLabel(SELF, undefined, 12, '2027-07-05')).toBe(
      'I am 12 or younger on Jul 5, 2027',
    );
    expect(ageConfirmationLabel(MAYA, undefined, 12, '2027-07-05')).toBe(
      'Maya R. is 12 or younger on Jul 5, 2027.',
    );
  });
});

describe('ageNotConfirmedMessage', () => {
  test('asks the account holder to confirm their own age', () => {
    expect(ageNotConfirmedMessage({ kind: 'self' })).toBe('Confirm your age to continue.');
  });

  test('names the child', () => {
    expect(ageNotConfirmedMessage({ kind: 'minor', minorName: 'Maya R.' })).toBe(
      "Confirm Maya R.'s age to continue.",
    );
  });

  test('says your child before a name is entered', () => {
    expect(ageNotConfirmedMessage({ kind: 'minor', minorName: ' ' })).toBe(
      "Confirm your child's age to continue.",
    );
  });
});

test('one guardian can register as many children for a session as a guardian can add to a season', () => {
  expect(MAX_MINORS_PER_SESSION).toBe(20);
});

describe('childNameError', () => {
  test('words an empty name for a child and keeps the field and code', () => {
    const checked = checkMinorName('   ');
    if (checked.ok) throw new Error('an empty name passes');
    expect(childNameError(checked.error)).toEqual({
      field: 'minorName',
      code: 'minorNameEmpty',
      message: "Enter your child's name.",
    });
  });

  test('leaves the other name errors as they are', () => {
    for (const name of ['x'.repeat(61), 'Maya\u200bR.']) {
      const checked = checkMinorName(name);
      if (checked.ok) throw new Error('the name passes');
      expect(childNameError(checked.error)).toBe(checked.error);
    }
  });
});
