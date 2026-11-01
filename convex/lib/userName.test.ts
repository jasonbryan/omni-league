import { describe, expect, test } from 'vitest';
import { checkUserName, MAX_USER_NAME_LENGTH } from './userName';

describe('checkUserName', () => {
  test('returns the trimmed name', () => {
    expect(checkUserName('  Maya Okafor ')).toEqual({ ok: true, name: 'Maya Okafor' });
  });

  test.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('refuses a name that is %s as empty', (_, name) => {
    expect(checkUserName(name)).toEqual({ ok: false, code: 'empty' });
  });

  test('counts after trimming: 100 characters with spaces around pass, 101 are too long', () => {
    expect(MAX_USER_NAME_LENGTH).toBe(100);
    expect(checkUserName(`  ${'x'.repeat(100)}  `)).toEqual({ ok: true, name: 'x'.repeat(100) });
    expect(checkUserName('x'.repeat(101))).toEqual({ ok: false, code: 'tooLong' });
  });

  test('counts UTF-16 units, as String.length does', () => {
    expect(checkUserName('😀'.repeat(50))).toEqual({ ok: true, name: '😀'.repeat(50) });
    expect(checkUserName(`${'😀'.repeat(50)}x`)).toEqual({ ok: false, code: 'tooLong' });
  });
});
