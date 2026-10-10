import { AFTER_AUTH_DEFAULT, afterAuthUrl, safeReturnTo } from './return-to';

// ADR 0008 "Return-to-registration URL": `returnTo` is accepted only when it starts with `/`, does
// not start with `//` or `/\`, and keeps a placeholder origin when parsed against it; anything else
// becomes `/`. Shared by sign-up (#62) and sign-in (#63).
describe('safeReturnTo', () => {
  it.each([
    ['/app', '/app'],
    ['/', '/'],
    ['/leagues/gulf-coast/register', '/leagues/gulf-coast/register'],
    ['/organizations/x?tab=leagues#top', '/organizations/x?tab=leagues#top'],
    ['/a/../app', '/app'],
    ['/app%2F..%2Fx', '/app%2F..%2Fx'],
  ])('accepts the same-site path %j as %j', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it.each([
    '//evil.example/x',
    '/\\evil.example/x',
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    ' /app',
    'https://evil.example/app',
    'http://localhost:4000/app',
    'javascript:alert(1)',
    'data:text/html,x',
    'app',
    '',
    '?returnTo=/app',
    '#/app',
  ])('turns %j into /', (raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });
});

describe('afterAuthUrl', () => {
  it('is /app when there is no returnTo', () => {
    expect(AFTER_AUTH_DEFAULT).toBe('/app');
    expect(afterAuthUrl(null)).toBe('/app');
    expect(afterAuthUrl(undefined)).toBe('/app');
  });

  it('is the validated returnTo otherwise, and / for an unsafe one', () => {
    expect(afterAuthUrl('/leagues/x/register')).toBe('/leagues/x/register');
    expect(afterAuthUrl('//evil.example/x')).toBe('/');
    expect(afterAuthUrl('')).toBe('/');
  });
});

// Tester (#62): dot segments and encoded dots resolve to a path that starts with `//` or `/\`
// after parsing. The router gets the parsed result, so the result itself must never name another
// host (`//host` is protocol-relative to `history.pushState` and to any later `callbackURL` use).
describe('safeReturnTo, dot segments that resolve to another host', () => {
  it.each([
    '/..//evil.example/x',
    '/.//evil.example/x',
    '/a/..//evil.example/x',
    '/%2e%2e//evil.example/x',
    '/%2E//evil.example/x',
    '/./\\evil.example/x',
    '/../\\evil.example/x',
  ])('never returns a protocol-relative path for %j', (raw) => {
    const result = safeReturnTo(raw);
    expect(result.startsWith('/')).toBe(true);
    expect(result.startsWith('//')).toBe(false);
    expect(result.startsWith('/\\')).toBe(false);
    expect(new URL(result, 'https://app.example').origin).toBe('https://app.example');
  });

  it.each(['/%2F%2Fevil.example', '/%5Cevil.example', '/%5C%5Cevil.example'])(
    'keeps the encoded slash or backslash %j as one same-site path segment',
    (raw) => {
      const result = safeReturnTo(raw);
      expect(result).toBe(raw);
      expect(new URL(result, 'https://app.example').origin).toBe('https://app.example');
    },
  );
});
