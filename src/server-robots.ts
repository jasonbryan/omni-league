/**
 * Static files get the same header from the `_headers` file that `scripts/ng-convex.mjs` writes for those builds; edge-function responses need it in code.
 * Web-API-only and no environment reads (ESLint, `src/server*.ts`): the flag is a build-time `--define`, never read from the environment at runtime.
 */

declare global {
  const __NOINDEX__: boolean;
}

export const NOINDEX_BUILD: boolean = typeof __NOINDEX__ !== 'undefined' && __NOINDEX__;

/**
 * A copy of `response` with `X-Robots-Tag: noindex`, replacing any value the route set. A copy,
 * because a response's headers can be immutable (`Response.redirect`).
 */
export function withNoindex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
