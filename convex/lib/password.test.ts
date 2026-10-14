import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import {
  constantTimeEqual,
  hashPassword,
  SCRYPT_KEY_BYTES,
  SCRYPT_LOG_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_SALT_BYTES,
  verifyPassword,
} from './password';

// Each hash takes about 0.4 s in the Convex runtime and longer here, so the cases share hashes.

const FORMAT = /^scrypt\$15\$8\$3\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
const PASSWORD = 'sandbar sunset spike 2026';

describe('hashPassword', () => {
  test('uses the OWASP 32 MiB setting and the self-describing format', async () => {
    expect([SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, SCRYPT_SALT_BYTES, SCRYPT_KEY_BYTES]).toEqual([
      15, 8, 3, 16, 32,
    ]);
    const stored = await hashPassword(PASSWORD);
    const match = FORMAT.exec(stored);
    expect(match, stored).not.toBeNull();

    const [, salt = '', key = ''] = match ?? [];
    const expected = await scryptAsync(PASSWORD.normalize('NFKC'), hexToBytes(salt), {
      N: 2 ** 15,
      r: 8,
      p: 3,
      dkLen: 32,
    });
    expect(key).toBe(bytesToHex(expected));

    const again = await hashPassword(PASSWORD);
    expect(FORMAT.exec(again)?.[1]).not.toBe(salt);
    await expect(verifyPassword({ hash: again, password: PASSWORD })).resolves.toBe(true);

    await expect(verifyPassword({ hash: stored, password: PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: stored, password: `${PASSWORD}!` })).resolves.toBe(false);
    await expect(verifyPassword({ hash: stored, password: '' })).resolves.toBe(false);
  }, 60_000);

  test('normalises the password with NFKC before hashing', async () => {
    // "ﬁ" (U+FB01) is "fi" under NFKC; "é" composed and decomposed are the same under NFKC.
    const stored = await hashPassword('ﬁve composed café words');
    await expect(
      verifyPassword({ hash: stored, password: 'five composed café words' }),
    ).resolves.toBe(true);
  }, 60_000);
});

describe('verifyPassword', () => {
  test('reads the parameters from the stored hash, so they can be raised later', async () => {
    const salt = new Uint8Array(16).fill(7);
    const key = await scryptAsync(PASSWORD, salt, { N: 2 ** 10, r: 8, p: 1, dkLen: 32 });
    const stored = `scrypt$10$8$1$${bytesToHex(salt)}$${bytesToHex(key)}`;
    await expect(verifyPassword({ hash: stored, password: PASSWORD })).resolves.toBe(true);
    await expect(verifyPassword({ hash: stored, password: 'another password!!' })).resolves.toBe(
      false,
    );
  });

  test.each([
    ['empty', ''],
    ['Better Auth default format', `${'a'.repeat(32)}:${'b'.repeat(128)}`],
    ['unknown algorithm', `bcrypt$15$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`],
    ['missing key', `scrypt$15$8$3$${'a'.repeat(32)}`],
    ['non-hex salt', `scrypt$15$8$3$${'z'.repeat(32)}$${'b'.repeat(64)}`],
    ['odd-length key', `scrypt$15$8$3$${'a'.repeat(32)}$${'b'.repeat(63)}`],
    ['N out of range', `scrypt$31$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`],
    ['r of zero', `scrypt$15$0$3$${'a'.repeat(32)}$${'b'.repeat(64)}`],
    ['p of zero', `scrypt$15$8$0$${'a'.repeat(32)}$${'b'.repeat(64)}`],
    ['non-numeric parameter', `scrypt$x$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}`],
    ['extra field', `scrypt$15$8$3$${'a'.repeat(32)}$${'b'.repeat(64)}$c`],
  ])('returns false, without throwing, for a malformed hash (%s)', async (_, stored) => {
    await expect(verifyPassword({ hash: stored, password: PASSWORD })).resolves.toBe(false);
  });
});

describe('constantTimeEqual', () => {
  test('is true only for equal bytes of equal length', () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2, 3, 4]))).toBe(true);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2, 3, 5]))).toBe(false);
    expect(constantTimeEqual(a, Uint8Array.from([0, 2, 3, 4]))).toBe(false);
    expect(constantTimeEqual(a, Uint8Array.from([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  test('reads every byte whatever the first difference (no early exit)', () => {
    // Count the element reads of each argument: an early-exit loop would stop at index 0.
    const reads = { a: 0, b: 0 };
    const counting = (bytes: Uint8Array, side: 'a' | 'b') =>
      new Proxy(bytes, {
        get(target, prop) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) reads[side]++;
          const value: unknown = Reflect.get(target, prop, target);
          return typeof value === 'function'
            ? ((value as (...args: unknown[]) => unknown).bind(target) as unknown)
            : value;
        },
      });
    const length = 32;
    const a = counting(new Uint8Array(length).fill(1), 'a');
    const b = counting(new Uint8Array(length).fill(2), 'b');
    expect(constantTimeEqual(a, b)).toBe(false);
    expect(reads).toEqual({ a: length, b: length });
  });
});
