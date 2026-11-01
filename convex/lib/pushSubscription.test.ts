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

describe('isAllowedPushEndpoint against URL tricks', () => {
  test.each([
    ['an allowed host as the user name', 'https://fcm.googleapis.com@evil.example/x'],
    ['a backslash before the allowed host', 'https://evil.example\\@fcm.googleapis.com/x'],
    ['the allowed host in the path', 'https://evil.example/.fcm.googleapis.com'],
    ['the allowed host in the query', 'https://evil.example/?h=.fcm.googleapis.com'],
    ['the allowed host in the fragment', 'https://evil.example/#.fcm.googleapis.com'],
    ['a percent-encoded dot after the allowed host', 'https://fcm.googleapis.com%2eevil.example/x'],
    ['a trailing dot', 'https://fcm.googleapis.com./x'],
    ['a parent of an allowed host', 'https://googleapis.com/x'],
    ['an IP address', 'https://142.250.74.106/fcm/send/x'],
    ['a wss: endpoint', 'wss://fcm.googleapis.com/fcm/send/x'],
    ['a protocol-relative endpoint', '//fcm.googleapis.com/fcm/send/x'],
    ['an explicit non-default port', 'https://web.push.apple.com:444/x'],
  ])('refuses %s', (_case, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  test('accepts the default https port, which the URL drops', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:443/fcm/send/abc')).toBe(true);
  });
});

describe('pushSubscriptionProblem at the key-length edges', () => {
  test.each([
    ['a p256dh of 0 bytes', { p256dh: '', auth: AUTH }, 'p256dh'],
    ['a p256dh of 66 bytes', { p256dh: point(4, 66), auth: AUTH }, 'p256dh'],
    ['a padded p256dh', { p256dh: `${point()}=`, auth: AUTH }, 'p256dh'],
    ['an auth of 0 bytes', { p256dh: point(), auth: '' }, 'auth'],
    ['a padded auth', { p256dh: point(), auth: `${AUTH}==` }, 'auth'],
    ['an auth with a leading space', { p256dh: point(), auth: ` ${AUTH}` }, 'auth'],
    ['an auth of 32 characters, 24 bytes', { p256dh: point(), auth: 'a'.repeat(32) }, 'auth'],
  ])('names %s', (_case, keys, problem) => {
    expect(
      pushSubscriptionProblem({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }),
    ).toBe(problem);
  });
});
