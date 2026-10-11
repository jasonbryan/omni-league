import { describe, expect, test } from 'vitest';
import {
  FREE_FAILURES,
  HARD_LIMIT,
  MAX_WAIT_MS,
  retryMinutes,
  throttleKey,
  tooManyAttemptsMessage,
  waitAfterFailures,
} from './signInThrottle';

const MINUTE = 60_000;

describe('waitAfterFailures (ADR 0008 "Rate limits and lockout")', () => {
  test('5 failures are free, then 1 minute doubling to a 1 hour cap', () => {
    expect(FREE_FAILURES).toBe(5);
    expect(MAX_WAIT_MS).toBe(60 * MINUTE);
    const waits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99].map(waitAfterFailures);
    expect(waits.map((ms) => ms / MINUTE)).toEqual([0, 0, 0, 0, 0, 1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  test('the hard limit is 100 consecutive failures', () => {
    expect(HARD_LIMIT).toBe(100);
  });
});

describe('retryMinutes', () => {
  test.each([
    [1, 1],
    [59, 1],
    [60, 1],
    [61, 2],
    [240, 4],
    [3600, 60],
  ])('%i seconds is %i minute(s), rounded up and at least 1', (seconds, minutes) => {
    expect(retryMinutes(seconds)).toBe(minutes);
  });
});

describe('tooManyAttemptsMessage', () => {
  test.each([
    [1, 'Too many attempts. Try again in 1 minute.'],
    [60, 'Too many attempts. Try again in 1 minute.'],
    [61, 'Too many attempts. Try again in 2 minutes.'],
    [240, 'Too many attempts. Try again in 4 minutes.'],
    [3600, 'Too many attempts. Try again in 60 minutes.'],
  ])('%i seconds reads %j', (seconds, message) => {
    expect(tooManyAttemptsMessage(seconds)).toBe(message);
  });
});

describe('throttleKey', () => {
  test('lowercases as Better Auth does when it finds the user, and keeps the rest', async () => {
    expect(await throttleKey('Maya.Okafor@Example.COM')).toBe('maya.okafor@example.com');
    expect(await throttleKey(' a@b.co')).toBe(' a@b.co');
  });

  test('an address past 254 characters becomes a fixed-size digest of its lowercase form', async () => {
    const long = `${'A'.repeat(300)}@example.com`;
    const key = await throttleKey(long);
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await throttleKey(long.toLowerCase())).toBe(key);
    expect(await throttleKey(`${'a'.repeat(301)}@example.com`)).not.toBe(key);
  });

  test('254 characters is kept as is', async () => {
    const edge = `${'a'.repeat(242)}@example.com`;
    expect(edge).toHaveLength(254);
    expect(await throttleKey(edge)).toBe(edge);
  });
});
