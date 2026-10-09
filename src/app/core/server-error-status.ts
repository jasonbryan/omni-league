import { RESPONSE_INIT, inject } from '@angular/core';
import { willRedirect } from './not-found-status';

/**
 * Sets the server response to 503 with `Cache-Control: no-store` through `RESPONSE_INIT`, for a
 * public page whose primary query failed or timed out during the server render (#60). The CDN
 * then never stores the error page, and crawlers do not index it as a soft 200. `RESPONSE_INIT`'s
 * headers start from the route's headers in `@angular/ssr` 22.2, so `no-store` replaces the
 * route's `s-maxage`.
 *
 * Call it in an injection context once the router has finished the navigation. It does nothing in
 * the browser, during prerender, and in unit tests, where `RESPONSE_INIT` is `null`, and nothing
 * when the engine will redirect a URL the router normalized (as `setNotFoundStatus` does): that
 * redirect is `no-store` already (`src/server-redirect.ts`), and its target renders on its own.
 */
export function setServerErrorStatus(): void {
  const responseInit = inject(RESPONSE_INIT, { optional: true });
  if (!responseInit || willRedirect()) return;
  responseInit.status = 503;
  const headers = new Headers(responseInit.headers);
  headers.set('Cache-Control', 'no-store');
  responseInit.headers = headers;
}
