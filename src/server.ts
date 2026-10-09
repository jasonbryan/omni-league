import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import {
  getAllowedHosts,
  getContext,
  getTrustProxyHeaders,
} from '@netlify/angular-runtime/app-engine.js';
import {
  badRequestResponse,
  internalServerErrorResponse,
  isMalformedPath,
  notFoundResponse,
  redactedErrorText,
} from './server-error-response';
import { withQueryCacheKey } from './server-cache';
import { leadingSlashesRedirect, withSafeRedirect } from './server-redirect';
import { NOINDEX_BUILD, withNoindex } from './server-robots';
import { isUnroutablePath } from './server-unroutable';

// SSR entry per ADR 0010 item 2. Netlify runs the exported `netlifyAppEngineHandler` in an edge
// function (the plugin finds it by that name); `scripts/serve-ssr.mjs` runs it locally.
// Web-API-only: no `node:` imports and no environment reads (ESLint enforces both).

type AppEngine = Pick<AngularAppEngine, 'handle'>;

let appEngine: AppEngine | undefined;
let noindex = NOINDEX_BUILD;

/**
 * Test seam: replaces the engine used by `netlifyAppEngineHandler`. `undefined` restores the real
 * engine, which is created on first use.
 */
export function setAppEngineForTesting(engine: AppEngine | undefined): void {
  appEngine = engine;
}

/**
 * Test seam: turns the `X-Robots-Tag: noindex` header on or off. `undefined` restores the
 * build-time flag (`__NOINDEX__`, see `src/server-robots.ts`).
 */
export function setNoindexForTesting(value: boolean | undefined): void {
  noindex = value ?? NOINDEX_BUILD;
}

function getAppEngine(): AppEngine {
  appEngine ??= new AngularAppEngine({
    allowedHosts: getAllowedHosts(),
    trustProxyHeaders: getTrustProxyHeaders(),
  });
  return appEngine;
}

/**
 * Renders the request with Angular. The error mapping lives here, not in a wrapper, because this
 * is the function the Netlify edge function exports:
 * - a path that cannot be percent-decoded: plain 400, without calling the engine;
 * - a path starting with `//` (Angular's NG05702): `no-store` 301 to the same path with one
 *   leading slash, without calling the engine (`src/server-redirect.ts`, #23);
 * - a path the router reads as `//...` or as a named-outlet route (`/(//evil.com)`, `/(a:b)`):
 *   plain 404 without calling the engine, so Angular logs no error for it
 *   (`src/server-unroutable.ts`);
 * - no matching route (`null`): plain 404. With the router's `**` route (#23) every path matches,
 *   and an unknown one renders the not-found view with status 404;
 * - a URL the router normalizes (`/x//`, `/x/(y)`): the engine's 302 to the normalized URL, where
 *   the not-found view renders (`setNotFoundStatus` in `src/app/core/not-found-status.ts`);
 * - anything thrown or rejected: plain 500, logged with the method, the pathname, and the error
 *   text with every query string redacted (a query string can carry a one-time token, ADR 0008).
 *
 * Every response with a `Location` is `no-store`, and one with a status other than 301, 302, 303,
 * 307, or 308 becomes a 302 to a path on this site (`withSafeRedirect` in
 * `src/server-redirect.ts`, PR #90).
 *
 * Every response carries `Netlify-Vary: query` unless the route set its own `Netlify-Vary`, so
 * Netlify's CDN never answers one query string with a response stored for another
 * (`src/server-cache.ts`, PR #90). On a non-production Netlify build every response also carries
 * `X-Robots-Tag: noindex` (#15).
 */
export async function netlifyAppEngineHandler(request: Request): Promise<Response> {
  const response = withQueryCacheKey(withSafeRedirect(await render(request), new URL(request.url)));
  return noindex ? withNoindex(response) : response;
}

async function render(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname, search } = url;
  if (isMalformedPath(pathname)) {
    return badRequestResponse();
  }
  const redirect = leadingSlashesRedirect(url);
  if (redirect) {
    return redirect;
  }
  if (isUnroutablePath(pathname, search)) {
    return notFoundResponse();
  }

  try {
    const result = await getAppEngine().handle(request, getContext());
    return result ?? notFoundResponse();
  } catch (error) {
    console.error(`Error handling ${request.method} ${pathname}:`, redactedErrorText(error));
    return internalServerErrorResponse();
  }
}

/** Request handler used by the Angular CLI (dev server and build). */
export const reqHandler = createRequestHandler(netlifyAppEngineHandler);
