import { describe, expect, test } from 'vitest';
import {
  base64UrlBytes,
  isAllowedPushEndpoint,
  isP256PublicKey,
  MAX_ENDPOINT_LENGTH,
  pushSubscriptionProblem,
} from './pushSubscription';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const point = (prefix = 4, length = 65) =>
  base64Url(Uint8Array.from({ length }, (_, i) => (i === 0 ? prefix : i)));
const AUTH = base64Url(new Uint8Array(16).fill(7));

describe('isAllowedPushEndpoint', () => {
  test.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://FCM.googleapis.com/fcm/send/abc',
  ])('accepts %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  test.each([
    ['http, not https', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['a host outside the list', 'https://push.example.com/abc'],
    ['a lookalike with the allowed host as a prefix', 'https://fcm.googleapis.com.evil.example/x'],
    ['a lookalike without the dot boundary', 'https://evilpush.apple.com/x'],
    ['a port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['credentials', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['not a URL', 'fcm.googleapis.com/fcm/send/abc'],
    ['an empty string', ''],
    ['an overlong endpoint', `https://fcm.googleapis.com/${'a'.repeat(MAX_ENDPOINT_LENGTH)}`],
  ])('refuses %s', (_case, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('base64UrlBytes', () => {
  test('decodes unpadded base64url, including - and _', () => {
    expect([...(base64UrlBytes('-_8') ?? [])]).toEqual([0xfb, 0xff]);
  });

  test.each(['ab+c', 'ab/c', 'abc=', 'a', 'ab c'])('refuses %j', (text) => {
    expect(base64UrlBytes(text)).toBeNull();
  });
});

describe('isP256PublicKey', () => {
  test('accepts an uncompressed 65-byte point', () => {
    expect(isP256PublicKey(point())).toBe(true);
  });

  test.each([
    ['64 bytes', point(4, 64)],
    ['66 bytes', point(4, 66)],
    ['a compressed prefix', point(2)],
  ])('refuses %s', (_case, key) => {
    expect(isP256PublicKey(key)).toBe(false);
  });
});

describe('pushSubscriptionProblem', () => {
  const valid = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: point(), auth: AUTH },
  };

  test('is null for a valid subscription, with or without an expiry', () => {
    expect(pushSubscriptionProblem(valid)).toBeNull();
    expect(pushSubscriptionProblem({ ...valid, expirationTime: null })).toBeNull();
    expect(pushSubscriptionProblem({ ...valid, expirationTime: 1_900_000_000_000 })).toBeNull();
  });

  test('names the first field that is wrong', () => {
    expect(pushSubscriptionProblem({ ...valid, endpoint: 'http://fcm.googleapis.com/x' })).toBe(
      'endpoint',
    );
    expect(pushSubscriptionProblem({ ...valid, keys: { ...valid.keys, p256dh: AUTH } })).toBe(
      'p256dh',
    );
    expect(
      pushSubscriptionProblem({
        ...valid,
        keys: { ...valid.keys, auth: base64Url(new Uint8Array(15)) },
      }),
    ).toBe('auth');
    expect(pushSubscriptionProblem({ ...valid, expirationTime: Number.NaN })).toBe(
      'expirationTime',
    );
    expect(pushSubscriptionProblem({ ...valid, expirationTime: -1 })).toBe('expirationTime');
  });
});
