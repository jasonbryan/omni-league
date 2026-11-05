import { describe, expect, test } from 'vitest';
import { MAX_PAYLOAD_BYTES, TEST_MESSAGE, pushPayload } from './pushMessage';

const SITE = 'https://staging.example.test';

describe('pushPayload', () => {
  test('carries the declarative-push marker, a title, and a click that opens the page', () => {
    expect(JSON.parse(pushPayload(TEST_MESSAGE, SITE))).toEqual({
      web_push: 8030,
      notification: {
        title: 'Omni League',
        body: TEST_MESSAGE.body,
        navigate: `${SITE}/app/notifications`,
        data: {
          onActionClick: {
            default: { operation: 'navigateLastFocusedOrOpen', url: '/app/notifications' },
          },
        },
      },
    });
  });

  test('the test notification fits one encrypted record with room to spare', () => {
    expect(new TextEncoder().encode(pushPayload(TEST_MESSAGE, SITE)).byteLength).toBeLessThan(
      MAX_PAYLOAD_BYTES,
    );
  });

  test('keeps only the origin of the site URL, whatever path it carries', () => {
    const navigate = (siteUrl: string) =>
      (JSON.parse(pushPayload(TEST_MESSAGE, siteUrl)) as { notification: { navigate: string } })
        .notification.navigate;
    expect(navigate('https://omni.example.test/some/page?x=1')).toBe(
      'https://omni.example.test/app/notifications',
    );
  });

  test.each(['//evil.example/x', 'https://evil.example/x', 'app/notifications', ''])(
    'refuses the path %j, which could leave the site',
    (path) => {
      expect(() => pushPayload({ ...TEST_MESSAGE, path }, SITE)).toThrow();
    },
  );

  test('refuses a payload over the limit', () => {
    expect(() =>
      pushPayload({ ...TEST_MESSAGE, body: 'x'.repeat(MAX_PAYLOAD_BYTES) }, SITE),
    ).toThrow('too large');
  });

  test('refuses a site URL that is not https or http', () => {
    expect(() => pushPayload(TEST_MESSAGE, 'not a url')).toThrow();
    expect(() => pushPayload(TEST_MESSAGE, 'javascript:alert(1)')).toThrow();
  });
});
