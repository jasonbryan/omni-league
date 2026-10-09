import type { AngularAppEngine } from '@angular/ssr';
import { netlifyAppEngineHandler, setAppEngineForTesting, setNoindexForTesting } from './server';

// Error behaviour of the SSR entry (#37, carried over from #30 and #24 / PR #38). Every case calls
// the exported `netlifyAppEngineHandler`, the function the Netlify edge function runs.

type Handle = AngularAppEngine['handle'];

function useEngine(handle: Handle) {
  const fake = { handle: vi.fn(handle) };
  setAppEngineForTesting(fake);
  return fake;
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function loggedText(): string {
  return vi
    .mocked(console.error)
    .mock.calls.flat()
    .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ''}` : String(arg)))
    .join('\n');
}

describe('netlifyAppEngineHandler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setAppEngineForTesting(undefined);
    setNoindexForTesting(undefined);
    vi.restoreAllMocks();
  });

  it('passes the engine response through unchanged', async () => {
    const page = new Response('<h1>Omni League</h1>', { status: 200 });
    const engine = useEngine(() => Promise.resolve(page));

    const response = await netlifyAppEngineHandler(request('/o/acme?q=1'));

    expect(response).toBe(page);
    expect(engine.handle).toHaveBeenCalledTimes(1);
  });

  it.each(['/%E0%A4%A', '/%E0%A4%A?q=ok', '/o/%?x=1', '/o/%E0%A4%A'])(
    'answers the malformed path %s with a plain 400 without calling the engine',
    async (path) => {
      const engine = useEngine(() => Promise.resolve(null));

      const response = await netlifyAppEngineHandler(request(path));

      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/);
      expect(await response.text()).toBe('Bad Request');
      expect(engine.handle).not.toHaveBeenCalled();
    },
  );

  it('answers an engine rejection with a plain 500 and logs only the method and pathname', async () => {
    const error = new Error(
      'render failed in /Users/someone/dist/omni-league/server/main.server.mjs',
    );
    error.stack = `Error: ${error.message}\n    at render (/Users/someone/dist/omni-league/server/main.server.mjs:1:1)`;
    useEngine(() => Promise.reject(error));

    const response = await netlifyAppEngineHandler(request('/x?ott=secret'));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/);
    expect(body).toBe('Internal Server Error');
    expect(body).not.toContain(error.message);
    expect(body).not.toContain('at ');
    expect(body).not.toContain('/Users/');

    expect(console.error).toHaveBeenCalled();
    const logged = loggedText();
    expect(logged).toContain('GET');
    expect(logged).toContain('/x');
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('ott=');
  });

  it.each([
    ['an Error whose message and stack hold the URL', (url: string) => new Error(`failed: ${url}`)],
    ['a non-Error value holding the URL', (url: string) => `failed: ${url}`],
  ])('keeps the query string out of the log when the engine throws %s', async (_, makeError) => {
    // A non-Error rejection is deliberate: app code can reject with anything.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    useEngine((req) => Promise.reject(makeError(req.url)));

    const response = await netlifyAppEngineHandler(request('/x?ott=SECRET'));

    expect(response.status).toBe(500);
    const logged = loggedText();
    expect(logged).toContain('/x');
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('ott=');
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
  ])('answers a rejection with %s with a plain 500 and a log line', async (_, makeValue) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    useEngine(() => Promise.reject(makeValue()));

    const response = await netlifyAppEngineHandler(request('/x?ott=SECRET'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain('GET /x');
    expect(loggedText()).not.toContain('SECRET');
  });

  it.each([
    ['a number', 42],
    ['an object', { a: 1 }],
    ['a Symbol', Symbol('stack')],
  ])(
    'answers an engine Error whose stack is %s with a plain 500 and one log line',
    async (_, stack) => {
      const error = new Error('render failed');
      Object.defineProperty(error, 'stack', { value: stack });
      useEngine(() => Promise.reject(error));

      const response = await netlifyAppEngineHandler(request('/x?ott=SECRET'));

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(loggedText()).toContain('Error: render failed');
      expect(loggedText()).not.toContain('SECRET');
    },
  );

  it('logs the redacted cause of an engine error', async () => {
    useEngine(() =>
      Promise.reject(
        new TypeError('fetch failed', { cause: new Error('ECONNREFUSED /api?ott=SECRET') }),
      ),
    );

    await netlifyAppEngineHandler(request('/x'));

    expect(loggedText()).toContain('Caused by: Error: ECONNREFUSED /api?<redacted>');
    expect(loggedText()).not.toContain('SECRET');
  });

  it('answers a synchronous throw from the engine with a plain 500', async () => {
    useEngine(() => {
      throw new Error('sync');
    });

    const response = await netlifyAppEngineHandler(request('/o/acme'));

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
  });

  it.each(['/o/acme', '/o/acme?q=%41', '/o/%E2%82%AC', '/o/acme?q=%', '/o/acme?q=%E0%A4%A', '/?%'])(
    'answers an engine URIError for %s (well-formed path) with 500, not 400',
    async (path) => {
      const engine = useEngine(() => Promise.reject(new URIError('URI malformed')));

      const response = await netlifyAppEngineHandler(request(path));

      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/);
      expect(await response.text()).toBe('Internal Server Error');
      expect(engine.handle).toHaveBeenCalledTimes(1);
    },
  );

  it('answers a null engine result with a plain 404 "Not found"', async () => {
    useEngine(() => Promise.resolve(null));

    const response = await netlifyAppEngineHandler(request('/does-not-exist'));

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/plain\b/);
    expect(await response.text()).toBe('Not found');
  });
});

// A request path that starts with two slashes (after URL parsing, so also `/\x`, `/x/..//x`, and
// `/%2e%2e//x`) makes Angular throw NG05702 before any component renders (#23). The handler answers
// with a permanent redirect to the same path with one leading slash: a relative `Location` that
// cannot name another host, so it is not an open redirect.
describe('netlifyAppEngineHandler, a path with a leading double slash', () => {
  afterEach(() => {
    setAppEngineForTesting(undefined);
    setNoindexForTesting(undefined);
    vi.restoreAllMocks();
  });

  /** `Location` resolved the way a browser does, against the URL it came from. */
  function resolvedLocation(response: Response, path: string): URL {
    return new URL(response.headers.get('Location') ?? '', `http://localhost${path}`);
  }

  it.each([
    ['//evil.com/x', '/evil.com/x'],
    ['///evil.com/x', '/evil.com/x'],
    ['/\\evil.com/x', '/evil.com/x'],
    ['/\\/\\evil.com', '/evil.com'],
    ['/\t/evil.com', '/evil.com'],
    ['/x/..//evil.com', '/evil.com'],
    ['/x/%2e%2e//evil.com', '/evil.com'],
    ['/%2E%2E//evil.com', '/evil.com'],
    ['//evil.com/x?next=//evil.com', '/evil.com/x?next=//evil.com'],
    ['//evil.com/%2F%2Fx', '/evil.com/%2F%2Fx'],
    ['//%2F/evil.com', '/%2F/evil.com'],
    ['//%5Cevil.com', '/%5Cevil.com'],
    ['//', '/'],
    ['//?q=1', '/?q=1'],
  ])('redirects %s to %s without calling the engine', async (path, location) => {
    const engine = useEngine(() => Promise.resolve(null));

    const response = await netlifyAppEngineHandler(new Request(`http://localhost${path}`));

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe(location);
    expect(resolvedLocation(response, path).origin).toBe('http://localhost');
    expect(await response.text()).toBe('');
    expect(engine.handle).not.toHaveBeenCalled();
  });

  it.each(['/a//b', '/evil.com', '/%2F%2Fevil.com', '/%5Cevil.com', '/x?next=//evil.com'])(
    'hands %s to the engine as it is (its path has one leading slash)',
    async (path) => {
      const page = new Response('<h1>Page not found</h1>', { status: 404 });
      const engine = useEngine(() => Promise.resolve(page));

      const response = await netlifyAppEngineHandler(request(path));

      expect(response).toBe(page);
      expect(engine.handle).toHaveBeenCalledTimes(1);
    },
  );

  // Every combination of up to four of these pieces after the first slash: whatever the parser
  // makes of it, the engine never sees a path starting with `//`, and a redirect stays on this site.
  it('never hands the engine a path starting with // and never redirects off the site', async () => {
    const pieces = [
      '/',
      '\\',
      '.',
      '..',
      '%2e',
      '%2E%2e',
      '%2f',
      '%5c',
      '\t',
      'x',
      'evil.com',
      '@',
    ];
    const paths: string[] = [];
    const build = (prefix: string, depth: number): void => {
      paths.push(prefix);
      if (depth === 4) return;
      for (const piece of pieces) build(prefix + piece, depth + 1);
    };
    build('/', 0);

    const seen: string[] = [];
    useEngine((req) => {
      seen.push(new URL(req.url).pathname);
      return Promise.resolve(new Response('ok'));
    });
    for (const path of paths) {
      const response = await netlifyAppEngineHandler(new Request(`http://localhost${path}`));
      if (response.status === 301) {
        expect(response.headers.get('Location'), path).toMatch(/^\/(?![/\\])/);
        expect(resolvedLocation(response, path).origin, path).toBe('http://localhost');
      } else {
        expect(response.status, path).toBe(200);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((pathname) => /^[/\\]{2}/.test(pathname))).toEqual([]);
  });

  it('is noindex on a non-production build', async () => {
    setNoindexForTesting(true);
    useEngine(() => Promise.resolve(null));

    const response = await netlifyAppEngineHandler(request('//evil.com/x'));

    expect(response.status).toBe(301);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

// `noindex` on non-production Netlify builds (#15, ADR 0010 item 6). The flag is the build-time
// `__NOINDEX__` define set by scripts/ng-convex.mjs from Netlify's CONTEXT; the server entry reads no
// environment at runtime.
describe('netlifyAppEngineHandler X-Robots-Tag', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setAppEngineForTesting(undefined);
    setNoindexForTesting(undefined);
    vi.restoreAllMocks();
  });

  it('is absent by default (a build without a non-production CONTEXT)', async () => {
    useEngine(() => Promise.resolve(null));

    const response = await netlifyAppEngineHandler(request('/does-not-exist'));

    expect(response.headers.has('X-Robots-Tag')).toBe(false);
  });

  it('is noindex on a rendered page, keeping its status, headers, and body', async () => {
    setNoindexForTesting(true);
    useEngine(() =>
      Promise.resolve(
        new Response('<h1>Omni League</h1>', {
          status: 200,
          statusText: 'OK',
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
            'Cache-Control': 'public, max-age=0, s-maxage=60',
          },
        }),
      ),
    );

    const response = await netlifyAppEngineHandler(request('/o/acme'));

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(response.headers.get('Content-Type')).toBe('text/html;charset=UTF-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60');
    expect(await response.text()).toBe('<h1>Omni League</h1>');
  });

  it('replaces an X-Robots-Tag the route set', async () => {
    setNoindexForTesting(true);
    useEngine(() =>
      Promise.resolve(new Response('ok', { headers: { 'X-Robots-Tag': 'index, follow' } })),
    );

    const response = await netlifyAppEngineHandler(request('/o/acme'));

    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('is noindex on a redirect whose headers are immutable', async () => {
    setNoindexForTesting(true);
    useEngine(() => Promise.resolve(Response.redirect('http://localhost/o/acme', 302)));

    const response = await netlifyAppEngineHandler(request('/o/old'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('http://localhost/o/acme');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it.each([
    ['the plain 404', '/does-not-exist', () => Promise.resolve(null), 404],
    ['the plain 400', '/%E0%A4%A', () => Promise.resolve(null), 400],
    ['the plain 500', '/x', () => Promise.reject(new Error('render failed')), 500],
  ] as const)('is noindex on %s', async (_, path, handle, status) => {
    setNoindexForTesting(true);
    useEngine(handle);

    const response = await netlifyAppEngineHandler(request(path));

    expect(response.status).toBe(status);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});
