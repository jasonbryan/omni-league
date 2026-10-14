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
import { hasUndecodableQuery } from './app/core/url-serializer';

// Netlify runs the exported `netlifyAppEngineHandler` in an edge function (the plugin finds it by that name); `scripts/serve-ssr.mjs` runs it locally.
// Web-API-only: no `node:` imports and no environment reads (ESLint enforces both).

type AppEngine = Pick<AngularAppEngine, 'handle'>;

let appEngine: AppEngine | undefined;
let noindex = NOINDEX_BUILD;

export function setAppEngineForTesting(engine: AppEngine | undefined): void {
  appEngine = engine;
}

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
 * The error mapping lives here, not in a wrapper, because this is the function the Netlify edge function exports.
 * A path the router cannot read (undecodable, a leading `//`, a named outlet, `/(`) is answered before the engine runs (`src/server-redirect.ts`, `src/server-unroutable.ts`), so Angular logs nothing and the CDN stores no home page under it.
 * A query string the router cannot decode (`/x?q=%`) is dropped before rendering, as the app's router does: the router would render `/` for it whatever the path was, and a redirect to the bare path would loop,
 * since Netlify copies the request's query string into a `Location` that has none. No matching route is a plain 404; a URL the router normalizes gets the engine's 302 (`setNotFoundStatus` in `src/app/core/not-found-status.ts`).
 * Every response with a `Location` is `no-store` (`withSafeRedirect`), and every response carries `Netlify-Vary: query` unless the route set its own (`src/server-cache.ts`),
 * and `X-Robots-Tag: noindex` on a non-production Netlify build. Anything thrown is a plain 500, logged with every query string redacted (a query string can carry a one-time token).
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
  // The query string is checked on its own: the router stops parsing `/x//?q=%` at `//`, but reads it as `/x/?q=%` once `Location` drops one trailing slash.
  const engineRequest = hasUndecodableQuery(search) ? withoutQuery(request, url) : request;

  try {
    const result = await getAppEngine().handle(engineRequest, getContext());
    return result ?? notFoundResponse();
  } catch (error) {
    console.error(`Error handling ${request.method} ${pathname}:`, redactedErrorText(error));
    return internalServerErrorResponse();
  }
}

function withoutQuery(request: Request, url: URL): Request {
  const bare = new URL(url);
  bare.search = '';
  return new Request(bare, request);
}

/** Request handler used by the Angular CLI (dev server and build). */
export const reqHandler = createRequestHandler(netlifyAppEngineHandler);
