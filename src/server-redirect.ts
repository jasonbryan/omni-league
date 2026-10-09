/**
 * Requests whose path starts with two slashes (#23). Angular refuses to render a protocol-relative
 * request URL (`NG05702`, thrown before any component runs), which the SSR entry would answer with
 * a 500. The URL parser has already turned `/\x`, `/x/..//x`, `/%2e%2e//x`, and a tab or newline
 * into the same `//x`, so the parsed pathname is the one place to check.
 *
 * Such a path gets a permanent redirect to the same path and query string with one leading slash,
 * where the router renders the page or the not-found view. The `Location` is relative and starts
 * with exactly one `/` followed by neither `/` nor `\`, so a browser resolves it on this site: it
 * is not an open redirect (`//evil.com/x` goes to `/evil.com/x` here, never to `evil.com`). It is
 * `no-store`, because it carries the request's query string (PR #90).
 *
 * Web-API-only: bundled into the Netlify edge function (ESLint enforces it for `src/server*.ts`).
 */

const LEADING_SLASHES = /^[/\\]+/;

/** The redirect for a path with a doubled leading slash, or `null` for any other path. */
export function leadingSlashesRedirect(url: URL): Response | null {
  if (!/^[/\\]{2}/.test(url.pathname)) return null;
  const location = url.pathname.replace(LEADING_SLASHES, '/') + url.search;
  return new Response(null, {
    status: 301,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}
