import { describe, expect, test } from 'vitest';
import { checkMinorName, minorNameKey, shortMinorName } from './minorName';

describe('shortMinorName', () => {
  test.each([
    ['Maya Rivera', 'Maya R.'],
    ['Maya', 'Maya'],
    ['  Ana de la Cruz ', 'Ana C.'],
    ['maya rivera', 'maya R.'],
  ])('%j gives %j', (name, short) => {
    expect(shortMinorName(name)).toBe(short);
  });
});

describe('checkMinorName', () => {
  test('trims and collapses inner spaces', () => {
    expect(checkMinorName('  Maya   Rivera ')).toEqual({ ok: true, name: 'Maya Rivera' });
  });

  test('refuses an empty name and one over 60 characters', () => {
    expect(checkMinorName('   ')).toMatchObject({ ok: false, error: { code: 'minorNameEmpty' } });
    expect(checkMinorName('M'.repeat(60))).toMatchObject({ ok: true });
    expect(checkMinorName('M'.repeat(61))).toMatchObject({
      ok: false,
      error: {
        field: 'minorName',
        code: 'minorNameTooLong',
        message: 'Use 60 characters or fewer. This name has 61.',
      },
    });
  });

  test('the key ignores case and spacing', () => {
    expect(minorNameKey(' maya  RIVERA')).toBe(minorNameKey('Maya Rivera'));
  });
});
