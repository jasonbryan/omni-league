import { safeReturnTo, returnToOrApp } from './return-to';

describe('safeReturnTo', () => {
  it.each([
    ['/app', '/app'],
    ['/leagues/gulf-coast/register', '/leagues/gulf-coast/register'],
    ['/organizations/x?tab=leagues#top', '/organizations/x?tab=leagues#top'],
    ['/a/../app', '/app'],
    ['/app%2F..%2Fx', '/app%2F..%2Fx'],
    ['/../app', '/app'],
    ['/./app?x=1', '/app?x=1'],
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
    '/..//evil.example/x',
    '/.//evil.example/x',
    '/a/..//evil.example/x',
    '/%2e%2e//evil.example/x',
    '/%2E//evil.example/x',
    '/./\\evil.example/x',
    '/../\\evil.example/x',
    '/.\t//evil.example/x',
    '/a/b/../..//evil.example',
  ])('turns %j into /', (raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });
});

describe('returnToOrApp', () => {
  it.each([
    [null, '/app'],
    [undefined, '/app'],
    ['/app', '/app'],
    ['/leagues/x/register?team=1#top', '/leagues/x/register?team=1#top'],
    ['/a/../app', '/app'],
  ])('sends returnTo %j to %j', (raw, expected) => {
    expect(returnToOrApp(raw)).toBe(expected);
  });

  it.each([
    '//evil.example/x',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '',
    'app',
    '/..//evil.example/x',
    '/%2e%2e//evil.example/x',
    '/\t/evil.example',
  ])('sends the unsafe returnTo %j to /app', (raw) => {
    expect(returnToOrApp(raw)).toBe('/app');
  });

  it.each(['/', '/?x=1', '/#top', '/.', '/./', '/..', '/a/..'])(
    'sends %j, the public home with nothing to show a signed-in user, to /app',
    (raw) => {
      expect(returnToOrApp(raw)).toBe('/app');
    },
  );
});

// Dot segments and encoded dots resolve to a path that starts with `//` or `/\` after parsing. The router gets the parsed result,
// so the result itself must never name another host (`//host` is protocol-relative to `history.pushState` and to any later `callbackURL` use).
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

describe('safeReturnTo, invariants over generated input', () => {
  const BASES = [
    'https://app.example',
    'http://localhost:4000',
    'https://deploy-preview-102--charming-longma-28c00d.netlify.app',
  ];

  function expectSameSitePath(raw: string): void {
    const result = safeReturnTo(raw);
    const context = `${JSON.stringify(raw)} -> ${JSON.stringify(result)}`;
    expect(result.startsWith('/'), context).toBe(true);
    expect(result.startsWith('//'), context).toBe(false);
    expect(result.startsWith('/\\'), context).toBe(false);
    expect(/[\\\t\n\r]/.test(result.split(/[?#]/)[0] ?? ''), context).toBe(false);
    for (const base of BASES) {
      expect(new URL(result, base).origin, `${context} against ${base}`).toBe(base);
    }
    expect(safeReturnTo(result), context).toBe(result);
  }

  const ATOMS = [
    '/',
    '\\',
    '.',
    '..',
    '%2e',
    '%2E',
    '%2e%2e',
    '.%2e',
    '%2f',
    '%2F',
    '%5c',
    '%5C',
    '\t',
    '\n',
    '\r',
    ' ',
    '\0',
    '%09',
    '%0a',
    '%00',
    'evil.example',
    '@',
    ':',
    '?',
    '#',
    ';',
    '%',
    '%2',
    'javascript:',
    'data:',
    'https:',
    '//',
    '/\\',
    '\\/',
    '／',
    '＼',
    '．',
    '。',
    '∕',
    '⁄',
    ' ',
    ' ',
    '%E3%80%82',
    'a',
  ];

  it('holds for 20,000 generated values', () => {
    let seed = 62;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 20_000; i++) {
      let raw = i % 4 === 0 ? '' : '/';
      for (let k = 1 + next(8); k > 0; k--) raw += ATOMS[next(ATOMS.length)];
      expectSameSitePath(raw);
    }
  });

  it.each([
    '/..%2f%2fevil.example',
    '/%2e%2e%2f%2fevil.example',
    '/%2e%2e%5c%5cevil.example',
    '/%2e%2e/%5cevil.example',
    '/..\\\\evil.example',
    '/..\\/evil.example',
    '/\\/evil.example',
    '/../\t/evil.example',
    '/.\n.//evil.example',
    '/\u0000//evil.example',
    '/%00//evil.example',
    '/..;//evil.example',
    '/ //evil.example',
    '/ //evil.example',
    '/／／evil.example',
    '/＼evil.example',
    '/．．//evil.example',
    '/%E3%80%82%E3%80%82//evil.example',
    '/\uD800//evil.example',
    '/x#//evil.example',
    '/x?next=//evil.example',
    '/@evil.example',
    '/:@evil.example',
    '/javascript:alert(1)',
    `/${'a'.repeat(100_000)}`,
    `/${'../'.repeat(20_000)}/evil.example`,
    `/${'%2e%2e/'.repeat(20_000)}/evil.example`,
  ])('keeps %j on this site', (raw) => {
    expectSameSitePath(raw);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'https://return-to.invalid/app',
    'https://return-to.invalid//evil.example',
    'http://localhost:4000/app',
    '\\/evil.example',
    '\t/app',
    '%2Fapp',
    '%2F%2Fevil.example',
    `/${'../'.repeat(20_000)}/evil.example`,
    `/${'%2e%2e/'.repeat(20_000)}/evil.example`,
  ])('turns %j into /', (raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });

  it('keeps a very long same-site path whole', () => {
    const raw = `/leagues/${'a'.repeat(100_000)}?x=1#top`;
    expect(safeReturnTo(raw)).toBe(raw);
  });
});
