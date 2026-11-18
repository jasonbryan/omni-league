import { describe, expect, test } from 'vitest';
import { singleClassIsOpen } from './trainingRegistration';

describe('singleClassIsOpen', () => {
  test('is open through the class date at UTC-12 and closed from the next date', () => {
    expect(singleClassIsOpen('2027-02-09', Date.parse('2027-02-08T12:00:00Z'))).toBe(true);
    expect(singleClassIsOpen('2027-02-09', Date.parse('2027-02-10T11:59:59Z'))).toBe(true);
    expect(singleClassIsOpen('2027-02-09', Date.parse('2027-02-10T12:00:00Z'))).toBe(false);
  });
});
