// Local SSR runner (ADR 0010 item 2): serves the production build the way Netlify does, with Node
// built-ins only. Static files come from dist/omni-league/browser/ with ADR 0010 item 3's cache
// headers; every other request goes to the same `netlifyAppEngineHandler` the edge function runs.
// It must not import @angular/ssr/node: that loads a second, unlinked copy of Angular.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

// Set before the import: the runtime then adds no Netlify hostnames to the allowed hosts.
process.env.NETLIFY_LOCAL = 'true';

const distDir = join(import.meta.dirname, '..', 'dist', 'omni-league');
const browserDir = join(distDir, 'browser');
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

/** The file under browser/ for this path, or undefined (escapes browser/, directory, missing). */
async function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined; // the handler answers 400
  }
  const file = join(browserDir, decoded);
  if (decoded.includes('\0') || !file.startsWith(browserDir + sep)) return undefined;
  const info = await stat(file).catch(() => undefined);
  return info?.isFile() ? { file, size: info.size } : undefined;
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

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  } catch {
    plainError(res, 400, 'Bad Request');
    return;
  }
  try {
    const found =
      (req.method === 'GET' || req.method === 'HEAD') && (await staticFile(url.pathname));
    if (found) {
      res.writeHead(200, {
        'Content-Type': MIME[extname(found.file)] ?? 'application/octet-stream',
        'Content-Length': found.size,
        'Cache-Control': HASHED.test(url.pathname)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(found.file).pipe(res);
      return;
    }
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const response = await netlifyAppEngineHandler(toWebRequest(req, url, controller.signal));
    await writeWebResponse(response, req, res);
  } catch (error) {
    // Pathname only: the query string can carry a one-time token (ADR 0008).
    console.error(`serve-ssr: error handling ${req.method} ${url.pathname}:`, error);
    plainError(res, 500, 'Internal Server Error');
  }
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  console.log(`Omni League SSR runner listening on http://localhost:${port}`);
});
