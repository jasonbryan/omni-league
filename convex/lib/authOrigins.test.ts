import { describe, expect, test } from 'vitest';
import { trustedOrigins } from './authOrigins';
import { PREVIEW_ORIGIN_PATTERN } from './previewOrigin';

// #62: `trustedOrigins` is SITE_URL, plus the request's Origin only when PREVIEW_ORIGIN_PATTERN is
// set, equals the constant in previewOrigin.ts, and the Origin matches it (ADR 0008, ADR 0010).

const SITE_URL = 'https://main--charming-longma-28c00d.netlify.app';
const PREVIEW = 'https://deploy-preview-62--charming-longma-28c00d.netlify.app';

function request(origin?: string): Request {
  return new Request('https://example.convex.site/api/auth/sign-up/email', {
    method: 'POST',
    headers: origin === undefined ? {} : { origin },
  });
}

describe('trustedOrigins', () => {
  test('is SITE_URL alone when PREVIEW_ORIGIN_PATTERN is unset (production)', () => {
    const env = { SITE_URL };
    expect(trustedOrigins(request(PREVIEW), env)).toEqual([SITE_URL]);
    expect(trustedOrigins(request('https://evil.example'), env)).toEqual([SITE_URL]);
    expect(trustedOrigins(undefined, env)).toEqual([SITE_URL]);
  });

  test('adds a matching Origin when PREVIEW_ORIGIN_PATTERN equals the constant', () => {
    const env = { SITE_URL, PREVIEW_ORIGIN_PATTERN };
    expect(trustedOrigins(request(PREVIEW), env)).toEqual([SITE_URL, PREVIEW]);
    expect(
      trustedOrigins(
        request('https://0123456789abcdef01234567--charming-longma-28c00d.netlify.app'),
        env,
      ),
    ).toEqual([SITE_URL, 'https://0123456789abcdef01234567--charming-longma-28c00d.netlify.app']);
  });

  test.each([
    'https://evil.example',
    'https://deploy-preview-62--other.netlify.app',
    'http://deploy-preview-62--charming-longma-28c00d.netlify.app',
    'https://deploy-preview-62--charming-longma-28c00d.netlify.app.evil.example',
    'https://charming-longma-28c00d.netlify.app',
    'null',
    '',
  ])('does not add the non-matching Origin %j', (origin) => {
    expect(trustedOrigins(request(origin), { SITE_URL, PREVIEW_ORIGIN_PATTERN })).toEqual([
      SITE_URL,
    ]);
  });

  test.each([
    ['a broader pattern', String.raw`^https://.*\.netlify\.app$`],
    ['a match-everything pattern', '.*'],
    ['the constant with a trailing space', `${PREVIEW_ORIGIN_PATTERN} `],
    ['an empty value', ''],
  ])('ignores PREVIEW_ORIGIN_PATTERN set to %s', (_, value) => {
    expect(trustedOrigins(request(PREVIEW), { SITE_URL, PREVIEW_ORIGIN_PATTERN: value })).toEqual([
      SITE_URL,
    ]);
  });

  test('trusts nothing extra without SITE_URL', () => {
    expect(trustedOrigins(request(PREVIEW), {})).toEqual([]);
    expect(trustedOrigins(request(PREVIEW), { PREVIEW_ORIGIN_PATTERN })).toEqual([PREVIEW]);
  });

  test('uses the origin of SITE_URL, without a path or trailing slash', () => {
    expect(trustedOrigins(undefined, { SITE_URL: `${SITE_URL}/some/path/` })).toEqual([SITE_URL]);
    expect(trustedOrigins(undefined, { SITE_URL: 'not a url' })).toEqual([]);
  });
});
