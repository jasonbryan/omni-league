import { RESPONSE_INIT, inject } from '@angular/core';
import { willRedirect } from './not-found-status';

/**
 * 503 with `no-store`, so the CDN never stores the error page and crawlers do not index it as a soft 200. `RESPONSE_INIT`'s headers start from the route's headers in `@angular/ssr` 22.2,
 * so `no-store` replaces the route's `s-maxage`. It does nothing when the engine will redirect a URL the router normalized (as `setNotFoundStatus` does):
 * that redirect is `no-store` already (`src/server-redirect.ts`), and its target renders on its own.
 */
export function setServerErrorStatus(): void {
  const responseInit = inject(RESPONSE_INIT, { optional: true });
  if (!responseInit || willRedirect()) return;
  responseInit.status = 503;
  const headers = new Headers(responseInit.headers);
  headers.set('Cache-Control', 'no-store');
  responseInit.headers = headers;
}
