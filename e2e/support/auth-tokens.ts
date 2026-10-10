import type { Page, Request } from '@playwright/test';

/** The Convex token endpoint on the deployment's site URL (`@convex-dev/better-auth`). */
export const TOKEN_PATH = '/api/auth/convex/token';

/** How long no token request may be in flight before the page counts as settled. */
const QUIET_MS = 750;

/**
 * Resolves once the page has started at least one Convex token request and none has been in flight
 * for `QUIET_MS`. Call it before the navigation that signs in or loads a signed-in page, and await
 * it before the next navigation: WebKit reports a cross-origin fetch that a navigation aborts as a
 * page error ("Fetch API cannot load … due to access control checks"). It waits on requests in
 * flight, not on a count, so it holds however many token requests a load makes (two today: the
 * first, and the fresh one the Convex client asks for once the server confirms the first).
 */
export function tokensSettled(page: Page): Promise<void> {
  let started = 0;
  let open = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const isToken = (request: Request) => new URL(request.url()).pathname === TOKEN_PATH;
  return new Promise((resolve) => {
    const onRequest = (request: Request) => {
      if (!isToken(request)) return;
      started += 1;
      open += 1;
      clearTimeout(timer);
    };
    const onDone = (request: Request) => {
      if (!isToken(request)) return;
      open -= 1;
      clearTimeout(timer);
      if (started > 0 && open === 0) timer = setTimeout(finish, QUIET_MS);
    };
    const finish = () => {
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
      resolve();
    };
    page.on('request', onRequest);
    page.on('requestfinished', onDone);
    page.on('requestfailed', onDone);
  });
}
