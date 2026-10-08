import {
  badRequestResponse,
  internalServerErrorResponse,
  isMalformedPath,
  notFoundResponse,
  redactedErrorText,
} from './server-error-response';

// Plain-text responses and the path-only 400 rule of the SSR entry (#37, from #24 / PR #38).
describe('server error responses', () => {
  it.each(['/%E0%A4%A', '/o/%', '/o/%E0%A4%A', '/%'])('treats %s as a malformed path', (path) => {
    expect(isMalformedPath(path)).toBe(true);
  });

  it.each(['/', '/o/acme', '/o/%E2%82%AC', '/o/%41'])('treats %s as a well-formed path', (path) => {
    expect(isMalformedPath(path)).toBe(false);
  });

  it.each([
    [badRequestResponse, 400, 'Bad Request'],
    [internalServerErrorResponse, 500, 'Internal Server Error'],
    [notFoundResponse, 404, 'Not found'],
  ] as const)('builds a plain-text response (%#)', async (build, status, body) => {
    const response = build();

    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(body);
  });

  it('builds a fresh response each time, so a body is never read twice', () => {
    expect(badRequestResponse()).not.toBe(badRequestResponse());
  });

  it('redacts every query string in an error message and stack', () => {
    const error = new TypeError('bad http://a@b/x?ott=SECRET and /y?k=2&t=SECRET2');
    error.stack = `${error.name}: ${error.message}\n    at f (file:///srv/app.mjs:1:1)`;

    const text = redactedErrorText(error);

    expect(text).not.toContain('SECRET');
    expect(text).toContain('http://a@b/x?<redacted>');
    expect(text).toContain('/y?<redacted>');
    expect(text).toContain('at f (file:///srv/app.mjs:1:1)');
  });

  it('redacts a thrown non-Error value', () => {
    expect(redactedErrorText('failed /x?ott=SECRET')).toBe('failed /x?<redacted>');
  });

  it.each([
    ['a null-prototype object', () => Object.create(null) as unknown],
    [
      'an object whose toString throws',
      () => ({
        toString() {
          throw new Error('toString failed');
        },
      }),
    ],
    [
      'a Proxy that throws on every operation',
      () =>
        new Proxy(
          {},
          {
            get() {
              throw new Error('get');
            },
            getPrototypeOf() {
              throw new Error('getPrototypeOf');
            },
            ownKeys() {
              throw new Error('ownKeys');
            },
          },
        ),
    ],
  ])('never throws for %s', (_, makeValue) => {
    const value = makeValue();

    expect(() => redactedErrorText(value)).not.toThrow();
    expect(redactedErrorText(value)).toMatch(/\S/);
  });

  it.each([
    ['a number', 42],
    ['an object', { a: 1 }],
    ['a Symbol', Symbol('stack')],
  ])('uses name: message, and never throws, for an Error whose stack is %s', (_, stack) => {
    const error = new TypeError('render failed for /x?ott=SECRET');
    Object.defineProperty(error, 'stack', { value: stack });

    expect(() => redactedErrorText(error)).not.toThrow();
    const text = redactedErrorText(error);
    expect(typeof text).toBe('string');
    expect(text).toContain('TypeError: render failed for /x?<redacted>');
    expect(text).not.toContain('SECRET');
  });

  it('keeps the detail of a plain-object rejection, redacted', () => {
    expect(redactedErrorText({ code: 'E_FETCH', url: '/x?ott=SECRET' })).toBe(
      '{"code":"E_FETCH","url":"/x?<redacted>',
    );
  });

  it('appends the redacted cause chain', () => {
    const inner = new Error('connect ECONNREFUSED for /api?ott=SECRET');
    const outer = new TypeError('fetch failed', { cause: inner });

    const text = redactedErrorText(outer);

    expect(text).toMatch(/^TypeError: fetch failed/);
    expect(text).toContain('\nCaused by: Error: connect ECONNREFUSED for /api?<redacted>');
    expect(text).not.toContain('SECRET');
  });

  it('logs a non-Error cause', () => {
    expect(redactedErrorText(new Error('outer', { cause: 'inner /x?t=SECRET' }))).toContain(
      '\nCaused by: inner /x?<redacted>',
    );
  });

  it('bounds the cause chain, so a cycle ends', () => {
    const error = new Error('loop');
    error.cause = error;

    const causes = redactedErrorText(error).match(/Caused by:/g) ?? [];

    expect(causes.length).toBeGreaterThan(0);
    expect(causes.length).toBeLessThanOrEqual(5);
  });

  it('keeps the error text when reading its cause throws', () => {
    const error = new Error('outer');
    Object.defineProperty(error, 'cause', {
      get() {
        throw new Error('cause getter');
      },
    });

    expect(redactedErrorText(error)).toMatch(/^Error: outer/);
  });
});
