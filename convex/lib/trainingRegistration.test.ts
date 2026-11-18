import { describe, expect, test } from 'vitest';
import { MINOR_KEY_END, MINOR_KEY_PREFIX, SELF_KEY } from './individualRegistration';
import {
  CLASS_KEY_END,
  CLASS_KEY_PREFIX,
  classParticipantKey,
  singleClassIsOpen,
} from './trainingRegistration';

describe('singleClassIsOpen', () => {
  test('is open through the class date at UTC-12 and closed from the next date', () => {
    expect(singleClassIsOpen('2027-02-09', Date.parse('2027-02-08T12:00:00Z'))).toBe(true);
    expect(singleClassIsOpen('2027-02-09', Date.parse('2027-02-10T11:59:59Z'))).toBe(true);
    expect(singleClassIsOpen('2027-02-09', Date.parse('2027-02-10T12:00:00Z'))).toBe(false);
  });
});

describe('classParticipantKey', () => {
  test('names the class and the participant, a child by the lower-cased name', () => {
    expect(classParticipantKey('c1', { kind: 'self' })).toBe('class:c1:self');
    expect(classParticipantKey('c1', { kind: 'minor', minorName: ' Maya  R. ' })).toBe(
      'class:c1:minor:maya r.',
    );
  });

  test('sorts inside its own range and outside the series keys', () => {
    const key = classParticipantKey('c1', { kind: 'minor', minorName: 'Zed' });
    expect(key >= CLASS_KEY_PREFIX && key < CLASS_KEY_END).toBe(true);
    expect(key >= MINOR_KEY_PREFIX && key < MINOR_KEY_END).toBe(false);
    expect(key).not.toBe(SELF_KEY);
    for (const series of [SELF_KEY, `${MINOR_KEY_PREFIX}zed`]) {
      expect(series >= CLASS_KEY_PREFIX && series < CLASS_KEY_END).toBe(false);
    }
  });
});
