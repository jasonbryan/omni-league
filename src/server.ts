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

// SSR entry per ADR 0010 item 2. Netlify runs the exported `netlifyAppEngineHandler` in an edge
// function (the plugin finds it by that name); `scripts/serve-ssr.mjs` runs it locally.
// Web-API-only: no `node:` imports and no environment reads (ESLint enforces both).

type AppEngine = Pick<AngularAppEngine, 'handle'>;

let appEngine: AppEngine | undefined;

/**
 * Test seam: replaces the engine used by `netlifyAppEngineHandler`. `undefined` restores the real
 * engine, which is created on first use.
 */
export function setAppEngineForTesting(engine: AppEngine | undefined): void {
  appEngine = engine;
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
 * - no matching route (`null`): plain 404;
 * - anything thrown or rejected: plain 500, logged with the method, the pathname, and the error
 *   text with every query string redacted (a query string can carry a one-time token, ADR 0008).
 */
export async function netlifyAppEngineHandler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (isMalformedPath(pathname)) {
    return badRequestResponse();
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
