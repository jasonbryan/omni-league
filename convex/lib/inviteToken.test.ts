import { describe, expect, test } from 'vitest';
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TOKEN_BYTES,
  MAX_INVITE_TOKEN_LENGTH,
  timingSafeEqual,
} from './inviteToken';

describe('inviteToken (#67)', () => {
  test('a token is 256 bits as 43 base64url characters', () => {
    expect(INVITE_TOKEN_BYTES * 8).toBe(256);
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('tokens differ', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
  });

  test('the hash is the SHA-256 of the text as 64 lower-case hex characters', async () => {
    // SHA-256("abc"), FIPS 180-2 test vector.
    expect(await hashInviteToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('timingSafeEqual is true for equal text only', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  test('a token longer than the limit is never a real token', () => {
    expect(MAX_INVITE_TOKEN_LENGTH).toBeGreaterThanOrEqual(43);
    expect(generateInviteToken().length).toBeLessThanOrEqual(MAX_INVITE_TOKEN_LENGTH);
  });
});
