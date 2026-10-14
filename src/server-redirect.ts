/**
 * Angular refuses to render a protocol-relative request URL (`NG05702`), so a path starting with `//` gets a permanent `no-store` redirect to the same path and query string with one leading slash.
 * The URL parser has already turned `/\x`, `/x/..//x`, `/%2e%2e//x`, and a tab or newline into `//x`, so the parsed pathname is the one place to check.
 * The `Location` starts with exactly one `/` followed by neither `/` nor `\`, so a browser resolves it on this site: it is not an open redirect.
 * Web-API-only: bundled into the Netlify edge function (ESLint enforces it for `src/server*.ts`).
 */

import { notFoundResponse } from './server-error-response';

const LEADING_SLASHES = /^[/\\]+/;

export function leadingSlashesRedirect(url: URL): Response | null {
  if (!/^[/\\]{2}/.test(url.pathname)) return null;
  const location = url.pathname.replace(LEADING_SLASHES, '/') + url.search;
  return new Response(null, {
    status: 301,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Any response with a `Location` is `no-store`, because the `Location` can carry the request's query string. A redirect status keeps its `Location`; any other status becomes a 302,
 * since the engine sends a redirect with the route's status and a 404 with a `Location` shows as the browser's own error page. A `Location` that is not a URL gives the plain 404.
 */
export function withSafeRedirect(response: Response, requestUrl: URL): Response {
  const location = response.headers.get('Location');
  if (location === null) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  if (REDIRECT_STATUSES.has(response.status)) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  void response.body?.cancel();
  let target: URL;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return notFoundResponse();
  }
  headers.set('Location', target.pathname.replace(LEADING_SLASHES, '/') + target.search);
  headers.delete('Content-Length');
  return new Response(null, { status: 302, headers });
}
