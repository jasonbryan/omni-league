import { describe, expect, test } from 'vitest';
import {
  MAX_RETRY_AFTER_SECONDS,
  SERVER_ERROR_BACKOFF_SECONDS,
  classifyPushStatus,
  retryAfterSeconds,
} from './pushResponse';

const NOW = Date.parse('2030-05-20T12:00:00Z');

describe('classifyPushStatus', () => {
  test.each([201, 202, 200])('%i is delivered', (status) => {
    expect(classifyPushStatus(status)).toBe('delivered');
  });
  test.each([404, 410])('%i is gone', (status) => {
    expect(classifyPushStatus(status)).toBe('gone');
  });
  test('413 is a payload that is too large', () => {
    expect(classifyPushStatus(413)).toBe('tooLarge');
  });
  test('429 is rate limited', () => {
    expect(classifyPushStatus(429)).toBe('rateLimited');
  });
  test.each([500, 502, 503, 599])('%i is a server error', (status) => {
    expect(classifyPushStatus(status)).toBe('serverError');
  });
  test.each([400, 401, 403, 405, 422, 301, 100])('%i is rejected', (status) => {
    expect(classifyPushStatus(status)).toBe('rejected');
  });
});

describe('retryAfterSeconds', () => {
  test('reads whole seconds', () => {
    expect(retryAfterSeconds('120', NOW)).toBe(120);
  });
  test('reads an HTTP date', () => {
    expect(retryAfterSeconds(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90);
  });
  test('caps the wait at one hour', () => {
    expect(retryAfterSeconds('86400', NOW)).toBe(MAX_RETRY_AFTER_SECONDS);
    expect(MAX_RETRY_AFTER_SECONDS).toBe(3600);
  });
  test.each([[null], [''], ['soon'], ['-5'], ['1.5']])(
    'falls back to a short wait for %j',
    (header) => {
      expect(retryAfterSeconds(header, NOW)).toBe(60);
    },
  );
  test('a date in the past waits the minimum', () => {
    expect(retryAfterSeconds(new Date(NOW - 5000).toUTCString(), NOW)).toBe(1);
  });
  test('zero waits the minimum', () => {
    expect(retryAfterSeconds('0', NOW)).toBe(1);
  });
});

test('three server-error retries back off', () => {
  expect(SERVER_ERROR_BACKOFF_SECONDS).toEqual([30, 120, 480]);
});
