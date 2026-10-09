/**
 * Cache key of edge-function responses (#23, PR #90). Netlify's CDN stores an edge-function
 * response whose `Cache-Control` allows it (ADR 0006 "Cacheable"). On PR #90's preview it keyed
 * the stored response by the path alone: `/x?token=B` got the HTML rendered for `/x?token=A`. A
 * query string can carry a one-time token (ADR 0008), and pages may render from the query string
 * (Angular conventions, Rendering), so every response of the handler sends `Netlify-Vary: query`,
 * which adds the whole query string to the cache key. A route that sets its own `Netlify-Vary`
 * (for example `query=season`) keeps it, and its HTML must then depend on no other parameter.
 *
 * Web-API-only: bundled into the Netlify edge function (ESLint enforces it for `src/server*.ts`).
 */

export const NETLIFY_VARY = 'Netlify-Vary';

/**
 * `response`, or a copy of it with `Netlify-Vary: query` when it has no `Netlify-Vary`. A copy,
 * because a response's headers can be immutable (`Response.redirect`).
 */
export function withQueryCacheKey(response: Response): Response {
  if (response.headers.has(NETLIFY_VARY)) return response;
  const headers = new Headers(response.headers);
  headers.set(NETLIFY_VARY, 'query');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
