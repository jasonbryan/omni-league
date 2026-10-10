import type { AngularAppEngine } from '@angular/ssr';
import type { Route } from '@angular/router';
import { routes } from './app/app.routes';
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

  it('passes the engine response through, adding only Netlify-Vary: query', async () => {
    const page = new Response('<h1>Omni League</h1>', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public' },
    });
    const engine = useEngine(() => Promise.resolve(page));

    const response = await netlifyAppEngineHandler(request('/o/acme?q=1'));

    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect([...response.headers]).toEqual([
      ['cache-control', 'public'],
      ['content-type', 'text/html;charset=UTF-8'],
      ['netlify-vary', 'query'],
    ]);
    expect(await response.text()).toBe('<h1>Omni League</h1>');
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

  it.each(['/o/acme', '/o/acme?q=%41', '/o/%E2%82%AC'])(
    'answers an engine URIError for %s (well-formed path and query) with 500, not 400',
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
    // The Location carries the request's query string, so no shared cache may store it.
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
    expect(engine.handle).not.toHaveBeenCalled();
  });

  it.each(['/a//b', '/evil.com', '/%2F%2Fevil.com', '/%5Cevil.com', '/x?next=//evil.com'])(
    'hands %s to the engine as it is (its path has one leading slash)',
    async (path) => {
      const engine = useEngine(() =>
        Promise.resolve(new Response('<h1>Page not found</h1>', { status: 404 })),
      );

      const response = await netlifyAppEngineHandler(request(path));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('<h1>Page not found</h1>');
      expect(engine.handle).toHaveBeenCalledTimes(1);
      expect(new URL(engine.handle.mock.calls[0][0].url).pathname).toBe(path.split('?')[0]);
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
    ['a malformed query string', '/x?q=%', () => Promise.resolve(new Response('ok')), 200],
  ] as const)('is noindex on %s', async (_, path, handle, status) => {
    setNoindexForTesting(true);
    useEngine(handle);

    const response = await netlifyAppEngineHandler(request(path));

    expect(response.status).toBe(status);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

// Netlify's CDN stores an edge-function response whose Cache-Control allows it, and on PR #90's
// preview it keyed the stored response by path alone: `/x?token=B` got the HTML rendered for
// `/x?token=A`, and `//x` got a 301 whose Location held another visitor's query string. Every
// response from the handler therefore varies the cache key by the whole query string, and the
// redirect, whose Location copies the query string, is never stored.
describe('netlifyAppEngineHandler cache key', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setAppEngineForTesting(undefined);
    setNoindexForTesting(undefined);
    vi.restoreAllMocks();
  });

  const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

  it.each([
    [
      'a cacheable rendered page',
      '/o/acme?ott=SECRET',
      () =>
        Promise.resolve(
          new Response('<h1>Page not found</h1>', {
            status: 404,
            headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
          }),
        ),
      404,
    ],
    [
      'an engine redirect with immutable headers',
      '/o/old?ott=SECRET',
      () => Promise.resolve(Response.redirect('http://localhost/o/acme?ott=SECRET', 302)),
      302,
    ],
    ['the plain 404', '/does-not-exist?ott=SECRET', () => Promise.resolve(null), 404],
    ['the plain 400', '/%E0%A4%A?ott=SECRET', () => Promise.resolve(null), 400],
    ['the plain 500', '/x?ott=SECRET', () => Promise.reject(new Error('render failed')), 500],
    ['the // redirect', '//x?ott=SECRET', () => Promise.resolve(null), 301],
    ['an unroutable path', '/(//evil.com)?ott=SECRET', () => Promise.resolve(null), 404],
    [
      'a malformed query string',
      '/x?ott=SECRET&q=%',
      () =>
        Promise.resolve(new Response('ok', { headers: { 'Cache-Control': PUBLIC_PAGE_CACHE } })),
      200,
    ],
  ] as const)('%s carries Netlify-Vary: query', async (_, path, handle, status) => {
    for (const flag of [false, true]) {
      setNoindexForTesting(flag);
      useEngine(handle);

      const response = await netlifyAppEngineHandler(new Request(`http://localhost${path}`));

      expect(response.status).toBe(status);
      expect(response.headers.get('Netlify-Vary')).toBe('query');
    }
  });

  it('keeps a Netlify-Vary the route set', async () => {
    useEngine(() =>
      Promise.resolve(new Response('ok', { headers: { 'Netlify-Vary': 'query=season' } })),
    );

    const response = await netlifyAppEngineHandler(request('/o/acme?season=2'));

    expect(response.headers.get('Netlify-Vary')).toBe('query=season');
  });

  it('the // redirect is no-store, also on a non-production build', async () => {
    setNoindexForTesting(true);
    useEngine(() => Promise.resolve(null));

    const response = await netlifyAppEngineHandler(request('//x?token=A'));

    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/x?token=A');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

// The router normalizes some URLs (`/x//` to `/x/`, `/x/(y)` to `/x`), and the engine then answers
// with a redirect that takes the status the route set. With the not-found view's 404 a production
// build sent 404 with a Location, an empty body, and the route's public Cache-Control, which the CDN
// stored; a development build threw "Invalid redirect status code: 404" (PR #90, round 2). A
// redirect's Location can carry the request's query string, so no shared cache may store one.
describe('netlifyAppEngineHandler, an engine response with a Location', () => {
  afterEach(() => {
    setAppEngineForTesting(undefined);
    setNoindexForTesting(undefined);
    vi.restoreAllMocks();
  });

  const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

  function engineResponse(status: number, location: string): () => Promise<Response> {
    return () =>
      Promise.resolve(
        new Response(null, {
          status,
          headers: {
            Location: location,
            'Cache-Control': PUBLIC_PAGE_CACHE,
            'Content-Type': 'text/html;charset=UTF-8',
            Vary: 'X-Forwarded-Prefix',
          },
        }),
      );
  }

  it.each([
    [404, '/x//?token=A/B', '/x/?token=A%2FB'],
    [404, '/organizations/(x)?ott=SECRET', '/organizations?ott=SECRET'],
    [200, '/x/(y)', '/x'],
    [500, '/x//', '/x/'],
    [404, '/app/x//', '/app/x/'],
  ])('turns a %i with a Location into a no-store 302 (%s)', async (status, path, location) => {
    for (const flag of [false, true]) {
      setNoindexForTesting(flag);
      useEngine(engineResponse(status, location));

      const response = await netlifyAppEngineHandler(request(path));

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe(location);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-Vary')).toBe('query');
      expect(response.headers.get('Vary')).toBe('X-Forwarded-Prefix');
      expect(response.headers.get('X-Robots-Tag')).toBe(flag ? 'noindex' : null);
      expect(await response.text()).toBe('');
    }
  });

  it.each([
    ['//evil.com/x?token=A', '/x?token=A'],
    ['https://evil.com/x?token=A', '/x?token=A'],
    ['/\\evil.com/x', '/x'],
    ['\\\\evil.com', '/'],
    ['http://localhost//evil.com', '/evil.com'],
    ['/a//b/', '/a//b/'],
    ['x/', '/o/x/'],
  ])('keeps the 302 for a Location of %s on this site: %s', async (location, expected) => {
    useEngine(engineResponse(404, location));

    const response = await netlifyAppEngineHandler(request('/o/acme'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(expected);
    expect(response.headers.get('Location')).toMatch(/^\/(?![/\\])/);
    expect(new URL(expected, 'http://localhost/o/acme').origin).toBe('http://localhost');
  });

  it('answers a 404 whose Location is not a URL with the plain 404', async () => {
    useEngine(engineResponse(404, 'http://['));

    const response = await netlifyAppEngineHandler(request('/o/acme'));

    expect(response.status).toBe(404);
    expect(response.headers.has('Location')).toBe(false);
    expect(await response.text()).toBe('Not found');
  });

  it.each([301, 302, 303, 307, 308])(
    'keeps a %i redirect and its Location, and makes it no-store',
    async (status) => {
      useEngine(engineResponse(status, '/x/?token=A%2FB'));

      const response = await netlifyAppEngineHandler(request('/x//?token=A/B'));

      expect(response.status).toBe(status);
      expect(response.headers.get('Location')).toBe('/x/?token=A%2FB');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Netlify-Vary')).toBe('query');
    },
  );

  it('makes a redirect with immutable headers no-store', async () => {
    useEngine(() => Promise.resolve(Response.redirect('http://localhost/o/acme?ott=SECRET', 302)));

    const response = await netlifyAppEngineHandler(request('/o/old?ott=SECRET'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('http://localhost/o/acme?ott=SECRET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('leaves a response without a Location as it is', async () => {
    useEngine(() =>
      Promise.resolve(
        new Response('<h1>Page not found</h1>', {
          status: 404,
          headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
        }),
      ),
    );

    const response = await netlifyAppEngineHandler(request('/x?token=A'));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe(PUBLIC_PAGE_CACHE);
    expect(await response.text()).toBe('<h1>Page not found</h1>');
  });
});

// A path with one leading slash that the router still reads as `//...` (`/(//evil.com)` is an empty
// first segment), as a named-outlet route (the app has no named `<router-outlet>`), or cannot parse
// at all can never render as itself. Angular would log NG05702 with a stack, or warn NG04018 and
// render `/`, on every such request. The handler answers the plain 404 without calling the engine.
describe('netlifyAppEngineHandler, a path the router cannot render', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setAppEngineForTesting(undefined);
    vi.restoreAllMocks();
  });

  it.each([
    '/(//evil.com)',
    '/(//evil.com)?q=1',
    '/(//x)/y',
    '/(//)',
    '/(//(evil.com:////',
    '/(a:b)',
    '/x/(a:b//c:d)',
    '/a(b',
    '/;a=b//x',
    // Angular's Location drops one trailing slash before the router parses the path.
    '/(x/',
    '/(x/?q=1',
    '/a(b/',
    '/(///',
    '/(a:b)/',
    '/x/(a:b)/',
    // The router parses the path and the query string together.
    '/a(?token=A/B',
    '/x/(?q=1',
    '/(/?q=1',
    // The router parses these to `/` and renders the home page for a path that is not `/` (#91).
    '/(',
    '/()x',
    '/()',
    '/(/',
    '/()/',
    '/()//',
    '/()(',
    '/()()',
    '/()x)',
    '/()x/y',
    '/()/x',
    '/()%20',
    '/()?q=1',
    // The unroutable path wins over a malformed query string (#91).
    '/(?q=%',
    '/()?q=%',
  ])('answers %s with the plain 404 without calling the engine', async (path) => {
    const engine = useEngine(() => Promise.resolve(new Response('ok')));

    const response = await netlifyAppEngineHandler(request(path));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(response.headers.has('Cache-Control')).toBe(false);
    expect(engine.handle).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    '/',
    '/?q=1',
    '/?utm_source=x',
    '/x',
    '/x/y',
    '/o/acme?q=%41',
    '/x?q=(//evil.com)',
    '/x(//evil.com)',
    '/x(y)',
    '/(x)',
    '/x/(y)',
    '/(/evil.com)',
    '/x/(//y)',
    '/x%28y%29',
    '/%28%2F%2Fevil.com%29',
    '/a(',
    '/a)',
    '/x/',
    '/x//',
    '/(x)/',
    '/x/(y)/',
    '/a(/',
    '/x?q=(a:b)',
    '/x?redirect=/(a:b)&q=a(b',
    '/x/?token=A/B',
  ])(
    'hands %s to the engine (the router reads one leading slash and only the primary outlet)',
    async (path) => {
      const engine = useEngine(() => Promise.resolve(new Response('ok')));

      const response = await netlifyAppEngineHandler(request(path));

      expect(response.status).toBe(200);
      expect(engine.handle).toHaveBeenCalledTimes(1);
    },
  );

  // The router cannot decode the query string, so it would warn NG04018 and render `/` whatever
  // the path was (#91). The handler renders the page as if there were no query string. Not a
  // redirect: Netlify copies the request's query string into a Location that has none, so a
  // redirect to the bare path would loop (PR #105).
  it.each([
    ['/x?q=%', '/x'],
    ['/?q=%', '/'],
    ['/?%', '/'],
    ['/o/acme?q=%E0%A4%A', '/o/acme'],
    ['/o/acme?q=%', '/o/acme'],
    ['/o/acme?ott=SECRET&ref=%', '/o/acme'],
    ['/x/?q=%', '/x/'],
    ['/%E2%82%AC?q=%', '/%E2%82%AC'],
    ['/x?q=a+%', '/x'],
  ])('renders %s, whose query string the router cannot decode, as %s', async (path, pathname) => {
    const engine = useEngine((req) =>
      Promise.resolve(
        new Response(`<h1>Page</h1><a href="${req.url}">self</a>`, {
          status: 200,
          headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public' },
        }),
      ),
    );

    const response = await netlifyAppEngineHandler(request(path));
    const body = await response.text();

    expect(engine.handle).toHaveBeenCalledTimes(1);
    const seen = engine.handle.mock.calls[0][0];
    expect(seen.url).toBe(`http://localhost${pathname}`);
    expect(new URL(seen.url).search).toBe('');
    expect(response.status).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('public');
    expect(response.headers.get('Netlify-Vary')).toBe('query');
    expect(body).toBe(`<h1>Page</h1><a href="http://localhost${pathname}">self</a>`);
    expect(body).not.toContain('?');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps the method and headers of a request whose query string it drops', async () => {
    const engine = useEngine(() => Promise.resolve(new Response(null, { status: 200 })));

    await netlifyAppEngineHandler(
      new Request('http://localhost/o/acme?ref=%', {
        method: 'HEAD',
        headers: { 'Accept-Language': 'fr', 'X-Forwarded-Prefix': '/p' },
      }),
    );

    const seen = engine.handle.mock.calls[0][0];
    expect(seen.method).toBe('HEAD');
    expect(seen.url).toBe('http://localhost/o/acme');
    expect(seen.headers.get('Accept-Language')).toBe('fr');
    expect(seen.headers.get('X-Forwarded-Prefix')).toBe('/p');
  });

  it('holds only while no route names an outlet', () => {
    const outlets = (list: readonly Route[]): string[] =>
      list.flatMap((route) => [
        ...(route.outlet ? [route.outlet] : []),
        ...outlets(route.children ?? []),
      ]);
    expect(outlets(routes)).toEqual([]);
  });
});
