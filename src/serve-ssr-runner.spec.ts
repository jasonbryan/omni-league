import { type ChildProcess, spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

// The local SSR runner (`scripts/serve-ssr.mjs`, #37) against a temporary copy of the build layout:
// the real runner script, a small `browser/` folder, and a fake `server/server.mjs` handler. The
// runner finds `dist/` relative to its own file, so the copy needs no configuration.

const FAKE_SERVER = `
export async function netlifyAppEngineHandler(request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/throw-null') throw Object.create(null);
  if (pathname === '/throw-tostring') throw { toString() { throw new Error('toString failed'); } };
  if (pathname === '/throw-cause') {
    throw new Error('fetch failed', { cause: new Error('refused ' + request.url) });
  }
  if (pathname.startsWith('/throw')) throw new Error('engine failed for ' + request.url);
  return new Response('ssr ' + pathname, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}
`;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const isRoot = process.getuid?.() === 0;
const hasIpv6Loopback = Object.values(networkInterfaces())
  .flat()
  .some((info) => info?.internal && info.family === 'IPv6' && info.address === '::1');
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((info) => info && !info.internal && info.family === 'IPv4')?.address;

let root: string;
let runner: ChildProcess;
let port: number;
let output = '';

function get(path: string, options: { host?: string; headers?: Record<string, string> } = {}) {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest(
      { host: options.host ?? '127.0.0.1', port, path, headers: options.headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Sends raw HTTP over one connection and resolves with everything the runner wrote back. */
function raw(text: string, { close }: { close?: 'half' | 'reset' } = {}) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (data += chunk));
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
    if (close === 'half') socket.end(text);
    else if (close === 'reset') socket.write(text, () => socket.resetAndDestroy());
    else socket.write(text);
  });
}

/** The log arrives on the runner's stderr, which is not ordered with the HTTP reply: poll for it. */
async function waitForOutput(text: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!output.includes(text)) {
    if (Date.now() > deadline) throw new Error(`no "${text}" in the runner output:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('local SSR runner (scripts/serve-ssr.mjs)', () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'serve-ssr-'));
    const browser = join(root, 'dist', 'omni-league', 'browser');
    mkdirSync(join(root, 'scripts'));
    mkdirSync(browser, { recursive: true });
    mkdirSync(join(root, 'dist', 'omni-league', 'server'));
    mkdirSync(join(root, 'secret'));
    copyFileSync(
      join(process.cwd(), 'scripts', 'serve-ssr.mjs'),
      join(root, 'scripts', 'serve-ssr.mjs'),
    );
    writeFileSync(join(root, 'dist', 'omni-league', 'server', 'server.mjs'), FAKE_SERVER);
    writeFileSync(join(root, 'secret', 'key.txt'), 'TOPSECRET');
    writeFileSync(join(browser, 'favicon.ico'), 'icon');
    writeFileSync(join(browser, 'data.xyz'), 'unknown type');
    writeFileSync(join(browser, 'locked.txt'), 'locked');
    chmodSync(join(browser, 'locked.txt'), 0o000);
    symlinkSync(join('..', '..', '..', 'secret', 'key.txt'), join(browser, 'link.txt'));
    symlinkSync(join('..', '..', '..', 'secret'), join(browser, 'linkdir'));
    symlinkSync('favicon.ico', join(browser, 'alias.ico'));
    writeFileSync(join(browser, 'index.html'), '<h1>prerendered</h1>');
    mkdirSync(join(browser, 'about'));
    writeFileSync(join(browser, 'about', 'index.html'), '<h1>about</h1>');
    mkdirSync(join(browser, 'media'));

    // Frequent garbage collection: Node ends the process when it collects a FileHandle that is
    // still open, so a leaked static-file handle fails the specs instead of passing silently.
    const gcEvery25ms = 'data:text/javascript,setInterval(globalThis.gc,25).unref()';
    const script = join(root, 'scripts', 'serve-ssr.mjs');
    runner = spawn(process.execPath, ['--expose-gc', '--import', gcEvery25ms, script], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    port = await new Promise<number>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        const match = /listening on http:\/\/localhost:(\d+)/.exec(output);
        if (match) resolve(Number(match[1]));
      };
      runner.stdout?.on('data', onData);
      runner.stderr?.on('data', onData);
      runner.on('exit', (code) => reject(new Error(`runner exited (${code}):\n${output}`)));
    });
  }, 20_000);

  afterAll(() => {
    runner?.kill();
    if (!root) return;
    try {
      chmodSync(join(root, 'dist', 'omni-league', 'browser', 'locked.txt'), 0o644);
    } catch {
      // beforeAll failed before locked.txt existed; remove the temp dir anyway.
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('serves a file from browser/ with nosniff', async () => {
    const reply = await get('/data.xyz');

    expect(reply.status).toBe(200);
    expect(reply.body).toBe('unknown type');
    expect(reply.headers['content-type']).toBe('application/octet-stream');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves a symlink that stays inside browser/', async () => {
    const reply = await get('/alias.ico');

    expect(reply.status).toBe(200);
    expect(reply.body).toBe('icon');
  });

  it.each(['/link.txt', '/linkdir/key.txt'])(
    'does not follow the symlink %s out of browser/',
    async (path) => {
      const reply = await get(path);

      expect(reply.body).not.toContain('TOPSECRET');
      expect(reply.body).toBe(`ssr ${path}`); // handed to the handler, which answers 404 in the app
    },
  );

  it.each([
    ['/', '<h1>prerendered</h1>'],
    ['/about', '<h1>about</h1>'],
    ['/about/', '<h1>about</h1>'],
  ])('serves the prerendered index.html for %s, as Netlify does', async (path, body) => {
    const reply = await get(path);

    expect(reply.status).toBe(200);
    expect(reply.body).toBe(body);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
  });

  it('serves no listing for a directory without index.html', async () => {
    expect((await get('/media/')).body).toBe('ssr /media/');
  });

  it.each(['//evil.example/favicon.ico', '//secret/key.txt'])(
    'treats the request target %s as a path, not a host',
    async (path) => {
      const reply = await get(path);

      expect(reply.body).toBe(`ssr ${path}`);
    },
  );

  it('answers an absolute-form request target with 400', async () => {
    expect((await get('http://evil.example/favicon.ico')).status).toBe(400);
  });

  // Without a port in Host, `http://localhost` + `http://evil.example/...` still parses (host
  // `localhosthttp`, path `//evil.example/...`), so only the "target starts with /" check gives 400.
  it.each(['http://evil.example/favicon.ico', 'http://evil.example/x'])(
    'answers the absolute-form target %s with 400 when Host has no port',
    async (path) => {
      const reply = await get(path, { headers: { Host: 'localhost' } });

      expect(reply.status).toBe(400);
      expect(reply.body).toBe('Bad Request');
    },
  );

  it.skipIf(isRoot)('answers an unreadable file with a plain 500 and keeps serving', async () => {
    const reply = await get('/locked.txt?ott=SECRET');

    expect(reply.status).toBe(500);
    expect(reply.body).toBe('Internal Server Error');
    expect(runner.exitCode).toBeNull();
    expect((await get('/favicon.ico')).status).toBe(200);
    await waitForOutput('error handling GET /locked.txt');
    expect(output).not.toContain('SECRET');
  });

  it('answers a request URL with credentials (Host: a@b) with 400 and logs no query', async () => {
    const reply = await get('/x?ott=SECRET', { headers: { Host: 'a@b' } });

    expect(reply.status).toBe(400);
    expect(reply.body).toBe('Bad Request');
    expect(output).not.toContain('SECRET');
  });

  it('logs a handler error without the query string', async () => {
    const reply = await get('/throw?ott=SECRET');

    expect(reply.status).toBe(500);
    expect(reply.body).toBe('Internal Server Error');
    await waitForOutput('error handling GET /throw:');
    expect(output).not.toContain('SECRET');
  });

  it.each(['/throw-null', '/throw-tostring'])(
    'answers a handler that throws an unprintable value (%s) with a plain 500 and a log line',
    async (path) => {
      const reply = await get(`${path}?ott=SECRET`);

      expect(reply.status).toBe(500);
      expect(reply.body).toBe('Internal Server Error');
      await waitForOutput(`error handling GET ${path}:`);
      expect(output).not.toContain('SECRET');
      expect(runner.exitCode).toBeNull();
    },
  );

  it('logs the redacted cause of a handler error', async () => {
    await get('/throw-cause?ott=SECRET');

    await waitForOutput('Caused by: Error: refused http://');
    expect(output).toMatch(/Caused by: Error: refused http:\/\/[^\s]+\/throw-cause\?<redacted>/);
    expect(output).not.toContain('SECRET');
  });

  // An empty Host would make the first path segment the URL's host (`http://` + '' + `/x/...`).
  it.each([
    ['/favicon.ico', 'HTTP/1.1', 'Host: \r\n'],
    ['/x/favicon.ico', 'HTTP/1.1', 'Host: \r\n'],
    ['/evil.example/', 'HTTP/1.1', 'Host: \r\n'],
    ['/favicon.ico', 'HTTP/1.0', ''],
  ])(
    'answers GET %s (%s) with an empty or missing Host with a plain 400',
    async (path, version, host) => {
      const reply = await raw(`GET ${path} ${version}\r\n${host}Connection: close\r\n\r\n`);

      expect(reply).toMatch(/^HTTP\/1\.1 400 /);
      expect(reply).toContain('\r\nBad Request');
      expect(reply).not.toContain('ssr ');
      expect(reply).not.toContain('image/x-icon');
    },
  );

  it.each(['half', 'reset'] as const)(
    'keeps serving, and logs no server error, when the client disconnects (%s close) before a static file is sent',
    async (close) => {
      for (let i = 0; i < 5; i++) {
        await raw('GET /about/ HTTP/1.1\r\nHost: localhost\r\n\r\n', { close });
      }
      // Long enough for the runner's garbage collection (every 25 ms) to find a leaked handle.
      await new Promise((resolve) => setTimeout(resolve, 200));
      // A later request's log line shows the runner has logged whatever the disconnects caused.
      await get(`/throw-after-${close}-close`);
      await waitForOutput(`error handling GET /throw-after-${close}-close:`);

      expect(runner.exitCode).toBeNull();
      expect(output).not.toContain('GET /about/');
      expect(output).not.toContain('ERR_STREAM_UNABLE_TO_PIPE');
      expect(output).not.toContain('FileHandle');
    },
  );

  it('listens on IPv4 loopback', async () => {
    expect((await get('/favicon.ico', { host: '127.0.0.1' })).status).toBe(200);
  });

  it.skipIf(!hasIpv6Loopback)('listens on IPv6 loopback', async () => {
    expect((await get('/favicon.ico', { host: '::1' })).status).toBe(200);
  });

  it('answers on localhost', async () => {
    expect((await get('/favicon.ico', { host: 'localhost' })).status).toBe(200);
  });

  it.skipIf(!lanAddress)('does not listen on a non-loopback address', async () => {
    await expect(get('/favicon.ico', { host: lanAddress })).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });
});
