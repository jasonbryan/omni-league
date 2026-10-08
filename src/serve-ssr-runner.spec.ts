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
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

// The local SSR runner (`scripts/serve-ssr.mjs`, #37) against a temporary copy of the build layout:
// the real runner script, a small `browser/` folder, and a fake `server/server.mjs` handler. The
// runner finds `dist/` relative to its own file, so the copy needs no configuration.

const FAKE_SERVER = `
export async function netlifyAppEngineHandler(request) {
  const { pathname } = new URL(request.url);
  if (pathname === '/throw') throw new Error('engine failed for ' + request.url);
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

    runner = spawn(process.execPath, [join(root, 'scripts', 'serve-ssr.mjs')], {
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
    if (root) {
      chmodSync(join(root, 'dist', 'omni-league', 'browser', 'locked.txt'), 0o644);
      rmSync(root, { recursive: true, force: true });
    }
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

  it.skipIf(isRoot)('answers an unreadable file with a plain 500 and keeps serving', async () => {
    const reply = await get('/locked.txt?ott=SECRET');

    expect(reply.status).toBe(500);
    expect(reply.body).toBe('Internal Server Error');
    expect(runner.exitCode).toBeNull();
    expect((await get('/favicon.ico')).status).toBe(200);
    expect(output).toContain('/locked.txt');
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
    expect(output).toContain('/throw');
    expect(output).not.toContain('SECRET');
  });

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
