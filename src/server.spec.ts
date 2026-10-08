import type { AngularAppEngine } from '@angular/ssr';
import { netlifyAppEngineHandler, setAppEngineForTesting } from './server';

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
