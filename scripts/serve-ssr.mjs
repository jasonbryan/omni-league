// Local SSR runner (ADR 0010 item 2): serves the production build the way Netlify does, with Node
// built-ins only. Static files come from dist/omni-league/browser/ with ADR 0010 item 3's cache
// headers; every other request goes to the same `netlifyAppEngineHandler` the edge function runs.
// It must not import the Node adapter of `@angular/ssr` (its `/node` entry point): that loads a
// second, unlinked copy of Angular.
import { open, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';
import { pipeline, Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

// Set before the import: the runtime then adds no Netlify hostnames to the allowed hosts.
process.env.NETLIFY_LOCAL = 'true';

const distDir = join(import.meta.dirname, '..', 'dist', 'omni-league');
// Real path, so a symlink inside browser/ that points elsewhere is caught (staticFile).
const browserRoot = await realpath(join(distDir, 'browser'));
const { netlifyAppEngineHandler } = await import(
  pathToFileURL(join(distDir, 'server', 'server.mjs')).href
);

// Mirrors the [[headers]] paths in netlify.toml: only content-hashed build outputs are immutable.
const HASHED = /^\/(?:media\/.+|(?:main|chunk|polyfills)-[^/]+\.js|styles-[^/]+\.css)$/;
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** The real path of `path` if it exists and resolves (through `..` or a symlink) inside browser/. */
async function realPathInside(path) {
  const real = await realpath(path).catch(() => undefined);
  return real === browserRoot || real?.startsWith(browserRoot + sep) ? real : undefined;
}

/**
 * The open file under browser/ for this path, or undefined when the path is missing, resolves
 * outside browser/, or is a directory without an index.html. A directory is answered with its
 * index.html (a prerendered route, as Netlify serves it), never a listing. A file that exists but
 * cannot be opened throws, so the caller answers 500.
 */
async function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined; // the handler answers 400
  }
  if (decoded.includes('\0')) return undefined;
  let real = await realPathInside(join(browserRoot, decoded));
  let info = real && (await stat(real));
  if (info?.isDirectory()) {
    real = await realPathInside(join(real, 'index.html'));
    info = real && (await stat(real));
  }
  if (!info?.isFile()) return undefined;
  return { file: real, size: info.size, handle: await open(real) };
}

/** Error text for the log with every query string removed: it can carry a one-time token (ADR 0008). */
function redactQuery(error) {
  const text =
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : `${error}`;
  return text.replace(/\?\S+/g, '?<redacted>');
}

function logError(req, pathname, error) {
  console.error(`serve-ssr: error handling ${req.method} ${pathname}: ${redactQuery(error)}`);
}

function toWebRequest(req, url, signal) {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (!req.rawHeaders[i].startsWith(':'))
      headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
  });
}

async function writeWebResponse(response, req, res) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  if (!response.body || req.method === 'HEAD') {
    res.end();
    return;
  }
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}

function plainError(res, status, body) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}

function sendFile(found, req, res, pathname) {
  res.writeHead(200, {
    'Content-Type': MIME[extname(found.file)] ?? 'application/octet-stream',
    'Content-Length': found.size,
    'Cache-Control': HASHED.test(pathname)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    found.handle.close().catch(() => undefined);
    res.end();
    return;
  }
  // pipeline closes the file and the response on error or client disconnect.
  pipeline(found.handle.createReadStream(), res, (error) => {
    if (!error || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    logError(req, pathname, error);
    plainError(res, 500, 'Internal Server Error');
  });
}

async function handle(req, res) {
  // The URL is `http://` + Host + the raw request target, so a target starting with `//` stays a
  // path (Netlify's behaviour) instead of naming a host. A target that is not a path (absolute
  // form, `*`), a Host that would change the URL's shape (`a@b`, `x/y`), or a URL or Web Request
  // that cannot be built is a client error.
  const host = req.headers.host ?? 'localhost';
  const target = req.url ?? '/';
  let url;
  try {
    if (!target.startsWith('/') || /[\s/?#@\\]/.test(host)) throw new TypeError('bad target');
    url = new URL(`http://${host}${target}`);
  } catch {
    plainError(res, 400, 'Bad Request');
    return;
  }
  try {
    const found =
      (req.method === 'GET' || req.method === 'HEAD') && (await staticFile(url.pathname));
    if (found) {
      sendFile(found, req, res, url.pathname);
      return;
    }
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    let request;
    try {
      request = toWebRequest(req, url, controller.signal);
    } catch {
      plainError(res, 400, 'Bad Request');
      return;
    }
    const response = await netlifyAppEngineHandler(request);
    await writeWebResponse(response, req, res);
  } catch (error) {
    logError(req, url.pathname, error);
    plainError(res, 500, 'Internal Server Error');
  }
}

// Loopback only: the build is not reachable from the network. Both families, because `localhost`
// resolves to ::1 first on macOS and to 127.0.0.1 first on most Linux hosts. ::1 is skipped when
// the host has no IPv6 loopback.
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

const ipv4 = createServer(handle);
const port = await listen(ipv4, Number(process.env.PORT ?? 4000), '127.0.0.1');
const ipv6 = createServer(handle);
await listen(ipv6, port, '::1').catch((error) => {
  if (error.code !== 'EADDRNOTAVAIL' && error.code !== 'EAFNOSUPPORT') throw error;
  console.log('serve-ssr: no IPv6 loopback; listening on 127.0.0.1 only');
});
console.log(`Omni League SSR runner listening on http://localhost:${port}`);
