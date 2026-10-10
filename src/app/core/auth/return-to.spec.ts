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
