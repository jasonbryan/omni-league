import type { Page, Request } from '@playwright/test';

/** The Convex token endpoint on the deployment's site URL (`@convex-dev/better-auth`). */
export const TOKEN_PATH = '/api/auth/convex/token';

/**
 * Token requests a signed-in load makes: the first, and the fresh one the Convex client asks for
 * once the server confirms the first (forceRefreshToken). The Convex client's second setAuth call
 * shares the first (#62 tester, round 3).
 */
const SIGNED_IN_LOAD_TOKENS = 2;

/**
 * Resolves once the page has started `expected` Convex token requests and every one has finished
 * or failed. Call it before the navigation that signs in or loads a signed-in page, and await it
 * before the next navigation: WebKit reports a cross-origin fetch that a navigation aborts as a
 * page error ("Fetch API cannot load … due to access control checks"). It counts requests rather
 * than waiting for a quiet spell, because on a preview the server's confirmation of the first token
 * can take longer than any fixed quiet window (#62 tester, round 4). If the load makes fewer, the
 * test times out at the `await`.
 */
export function tokensSettled(page: Page, expected = SIGNED_IN_LOAD_TOKENS): Promise<void> {
  let started = 0;
  let inFlight = 0;
  const isToken = (request: Request) => new URL(request.url()).pathname === TOKEN_PATH;
  return new Promise((resolve) => {
    const onRequest = (request: Request) => {
      if (!isToken(request)) return;
      started += 1;
      inFlight += 1;
    };
    const onDone = (request: Request) => {
      if (!isToken(request)) return;
      inFlight -= 1;
      if (started >= expected && inFlight === 0) finish();
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
