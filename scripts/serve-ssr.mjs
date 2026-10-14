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

// Mirrors the [[headers]] paths in netlify.toml.
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

async function realPathInside(path) {
  const real = await realpath(path).catch(() => undefined);
  return real === browserRoot || real?.startsWith(browserRoot + sep) ? real : undefined;
}

// A directory is answered with its index.html (a prerendered route, as Netlify serves it), never a
// listing.
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

// Kept in step with redactedErrorText in src/server-error-response.ts, which the runner cannot
// import (it is bundled into server.mjs and not exported).
const UNPRINTABLE = '<unprintable thrown value>';
const MAX_CAUSES = 5;

function describeOrFallback(value) {
  try {
    if (value instanceof Error) {
      // `stack` is an ordinary writable property, so it can hold anything (a number, a Symbol).
      const stack = value.stack;
      return typeof stack === 'string' ? stack : `${value.name}: ${value.message}`;
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    }
    return String(value);
  } catch {
    return UNPRINTABLE;
  }
}

// Every query string is removed from the log: it can carry a one-time token.
function redactQuery(error) {
  let text = describeOrFallback(error);
  try {
    let current = error;
    for (let depth = 0; depth < MAX_CAUSES && current instanceof Error; depth++) {
      const cause = current.cause;
      if (cause === undefined) break;
      text += `\nCaused by: ${describeOrFallback(cause)}`;
      current = cause;
    }
  } catch {
    // A `cause` getter or an `instanceof` check threw: keep the text collected so far.
  }
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
  // Closed explicitly on every path: Node ends the process when a FileHandle is garbage-collected
  // while still open, and a stream piped into a closed response does not always close it.
  const close = () => found.handle.close().catch(() => undefined);
  if (res.destroyed || req.method === 'HEAD') {
    close();
    if (!res.destroyed) res.writeHead(200, staticHeaders(found, pathname)).end();
    return;
  }
  res.writeHead(200, staticHeaders(found, pathname));
  pipeline(found.handle.createReadStream({ autoClose: false }), res, (error) => {
    close();
    // A client that disconnected is not a server error. Every other error (a failed read) is
    // logged. `res.destroyed` cannot tell them apart: `pipeline` destroys `res` before this callback
    // in both cases. No 500 is possible here: the 200 headers are already written, and destroying
    // the response cuts the body short, so the client sees an incomplete transfer.
    if (!error || error.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    logError(req, pathname, error);
  });
}

function staticHeaders(found, pathname) {
  return {
    'Content-Type': MIME[extname(found.file)] ?? 'application/octet-stream',
    'Content-Length': found.size,
    'Cache-Control': HASHED.test(pathname)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  };
}

async function handle(req, res) {
  // The URL is `http://` + Host + the raw request target, so a target starting with `//` stays a
  // path (Netlify's behaviour) instead of naming a host. A target that is not a path (absolute
  // form, `*`), a Host that would change the URL's shape (`a@b`, `x/y`), or a URL or Web Request
  // that cannot be built is a client error. So is an empty or missing Host: `http://` + '' + target
  // would make the first path segment the host.
  const host = req.headers.host ?? '';
  const target = req.url ?? '/';
  let url;
  try {
    if (!target.startsWith('/') || host === '' || /[\s/?#@\\]/.test(host)) {
      throw new TypeError('bad target');
    }
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
    // A client that disconnected aborts the request; that is not a server error.
    if (res.destroyed) return;
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

// With PORT=0 the port comes from 127.0.0.1, and it can already be taken on ::1; then both are
// retried on a new port, a few times.
async function listenOnLoopback(requested) {
  for (let attempt = 1; ; attempt++) {
    const ipv4 = createServer(handle);
    const port = await listen(ipv4, requested, '127.0.0.1');
    try {
      await listen(createServer(handle), port, '::1');
      return port;
    } catch (error) {
      if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') {
        console.log('serve-ssr: no IPv6 loopback; listening on 127.0.0.1 only');
        return port;
      }
      if (error.code !== 'EADDRINUSE' || requested !== 0 || attempt >= 5) throw error;
      await new Promise((resolve) => ipv4.close(resolve));
    }
  }
}

const port = await listenOnLoopback(Number(process.env.PORT ?? 4000));
console.log(`Omni League SSR runner listening on http://localhost:${port}`);
