/**
 * Angular refuses to render a protocol-relative request URL (`NG05702`, thrown before any component runs), which the SSR entry would answer with a 500.
 * The URL parser has already turned `/\x`, `/x/..//x`, `/%2e%2e//x`, and a tab or newline into the same `//x`, so the parsed pathname is the one place to check.
 *
 * Such a path gets a permanent redirect to the same path and query string with one leading slash, where the router renders the page or the not-found view.
 * The `Location` is relative and starts with exactly one `/` followed by neither `/` nor `\`, so a browser resolves it on this site: it is not an open redirect
 * (`//evil.com/x` goes to `/evil.com/x` here, never to `evil.com`). It is `no-store`, because it carries the request's query string.
 *
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
 * A response without a `Location` is returned as it is. Any other response:
 * - is `Cache-Control: no-store`, because its `Location` can carry the request's query string;
 * - keeps a redirect status (301, 302, 303, 307, 308) and its `Location`;
 * - with any other status becomes a 302 with an empty body. The router normalizes some URLs
 *   (`/x//` to `/x/`, `/x/(y)` to `/x`), and the engine then sends a redirect with the status the
 *   route set: a 404 with a `Location` in a production build, which a browser shows as its own
 *   error page. Its `Location` becomes a path on this site with one leading slash, followed by
 *   the query string the engine wrote. A `Location` that is not a URL gives the plain 404.
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
