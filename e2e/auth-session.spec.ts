// AuthService's session and Convex token handling in a real browser (#62 tester, after the #115
// merge). A browser with no stored session token is signed out without a get-session request; a
// stored one is asked about once; sign-out removes it. A failed or refused token request never
// authenticates the Convex client, so `users.me` never answers with a name.
import { test as base, type Page } from '@playwright/test';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { stubNetlifyDrawer } from './support/netlify-drawer';
import { newUser, type TestUser } from './support/users';

/** The crossDomain plugin's store in `localStorage` (`@convex-dev/better-auth`). */
const STORE_KEY = 'better-auth_cookie';
const GET_SESSION = '/api/auth/get-session';
const TOKEN = '/api/auth/convex/token';

/** Every `/api/auth/*` request path the page makes, in order. */
function authRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/auth/')) seen.push(pathname);
  });
  return seen;
}

const count = (seen: readonly string[], path: string) => seen.filter((p) => p === path).length;

/**
 * Resolves once the page has made at least one token request and none is in flight for 500 ms,
 * so the next navigation aborts no token fetch (WebKit reports an aborted one as a page error). A
 * signed-in page load makes three today, so a fixed count is not used.
 */
function tokensSettled(page: Page): Promise<void> {
  let started = 0;
  let open = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise((resolve) => {
    const isToken = (url: string) => new URL(url).pathname === TOKEN;
    const check = () => {
      clearTimeout(timer);
      if (started > 0 && open === 0) timer = setTimeout(resolve, 500);
    };
    page.on('request', (request) => {
      if (!isToken(request.url())) return;
      started += 1;
      open += 1;
      clearTimeout(timer);
    });
    const done = (request: { url(): string }) => {
      if (!isToken(request.url())) return;
      open -= 1;
      check();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });
}

/** True when the crossDomain store holds a session token with a value (empty means cleared). */
async function storesSessionToken(page: Page): Promise<boolean> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORE_KEY);
  const parsed = JSON.parse(raw ?? '{}') as Record<string, { value?: string } | null>;
  return Object.entries(parsed).some(
    ([key, entry]) => key.includes('session_token') && !!entry?.value,
  );
}

async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  await page.locator('#name').fill(user.name);
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
  await page.getByRole('button', { name: /Create account/ }).click();
}

const panel = (page: Page) => page.getByRole('region', { name: 'Signed-in account' });

/** Waits until the page's network is quiet, so the lazy auth chunk has loaded and answered. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

test.describe('auth session store', () => {
  test('an anonymous visitor makes no get-session or token request on any page', async ({
    page,
  }) => {
    const seen = authRequests(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await settle(page);
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
    await settle(page);
    // The guard needs the answer, so this proves the auth chunk loaded and answered signed out.
    await page.goto('/app');
    await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fapp`);
    await settle(page);
    expect(seen).toEqual([]);
  });

  test('signed in, a reload asks get-session and stays signed in; after sign-out no request is made', async ({
    page,
  }) => {
    const user = newUser('Reload');
    const firstTokens = tokensSettled(page);
    await signUp(page, user);
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(panel(page)).toContainText(user.name);
    await firstTokens;

    const seen = authRequests(page);
    const reloadTokens = tokensSettled(page);
    await page.reload();
    await expect(panel(page)).toContainText(user.name);
    await reloadTokens;
    expect(count(seen, GET_SESSION)).toBeGreaterThanOrEqual(1);

    await panel(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    expect(await storesSessionToken(page)).toBe(false);
    // The sign-out response stores an empty session token; the session store's refetch removes it.
    await settle(page);

    seen.length = 0;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await settle(page);
    await page.goto('/app');
    await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fapp`);
    await settle(page);
    expect(seen).toEqual([]);
  });

  test('an expired stored session token is signed out with no request', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => {
      const expired = { value: 'expired.token', expires: '2000-01-01T00:00:00.000Z' };
      localStorage.setItem(key, JSON.stringify({ 'better-auth.session_token': expired }));
    }, STORE_KEY);
    const seen = authRequests(page);
    await page.goto('/app');
    await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fapp`);
    await settle(page);
    expect(seen).toEqual([]);
  });

  test('an unknown stored session token is asked about, ends signed out, and is removed', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate((key) => {
      const forged = { value: 'forged-token.forged-signature', expires: null };
      localStorage.setItem(key, JSON.stringify({ 'better-auth.session_token': forged }));
    }, STORE_KEY);
    const seen = authRequests(page);
    await page.goto('/app');
    await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fapp`);
    await settle(page);
    // The server clears the unknown token, which changes the stored value; the crossDomain plugin
    // then notifies the session signal, so a second get-session may follow.
    expect(count(seen, GET_SESSION)).toBeGreaterThanOrEqual(1);
    expect(count(seen, GET_SESSION)).toBeLessThanOrEqual(2);
    expect(count(seen, TOKEN)).toBe(0);
    expect(await storesSessionToken(page)).toBe(false);
  });

  for (const raw of [
    'not json',
    '[]',
    '"text"',
    '{}',
    '{"better-auth.session_token":{}}',
    'null',
    '{"better-auth.session_token":null}',
  ]) {
    test(`a malformed store value ${raw} is signed out and the guard answers`, async ({ page }) => {
      await page.goto('/');
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORE_KEY, raw]);
      await page.goto('/app');
      await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fapp`);
      await settle(page);
    });
  }
});

/**
 * Failure injection: an aborted request logs a resource error that the console fixture would
 * report, so these use the plain `test` and check page errors and console errors themselves.
 */
base.describe('auth token failures', () => {
  base.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await stubNetlifyDrawer(context);
  });

  for (const failure of ['network', 'http-500', 'forged-token'] as const) {
    base(
      `a ${failure} token request never authenticates Convex and raises no page error`,
      async ({ page }) => {
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') {
            consoleErrors.push(`${message.type()}: ${message.text()}`);
          }
        });
        const user = newUser('TokenFail');
        const meAnswers: unknown[] = [];
        page.on('websocket', (socket) => {
          socket.on('framereceived', ({ payload }) => {
            const text = typeof payload === 'string' ? payload : payload.toString();
            if (text.includes('"Transition"') && text.includes(user.name)) meAnswers.push(text);
          });
        });

        const firstTokens = tokensSettled(page);
        await signUp(page, user);
        await expect(page).toHaveURL(`${baseURL}/app`);
        await expect(panel(page)).toContainText(user.name);
        await firstTokens;
        meAnswers.length = 0;
        consoleErrors.length = 0;

        let tokenRequests = 0;
        await page.route(
          (url) => url.pathname === TOKEN,
          async (route) => {
            tokenRequests += 1;
            if (failure === 'network') return route.abort('failed');
            const headers = {
              'access-control-allow-origin': new URL(baseURL).origin,
              'access-control-allow-credentials': 'true',
              'content-type': 'application/json',
            };
            if (failure === 'http-500') {
              return route.fulfill({ status: 500, headers, body: '{"message":"boom"}' });
            }
            // A well-formed JWT with a signature the deployment never issued.
            const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
            const token = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: 'x', iss: 'x', aud: 'convex', exp: 4102444800 })}.c2ln`;
            return route.fulfill({ status: 200, headers, body: JSON.stringify({ token }) });
          },
        );

        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
        await expect.poll(() => tokenRequests).toBeGreaterThanOrEqual(1);
        // Give the Convex client time to authenticate if it were going to.
        await page.waitForTimeout(3_000);
        await expect(panel(page)).toHaveCount(0);
        expect(meAnswers).toEqual([]);
        expect(pageErrors).toEqual([]);
        // Only the browser's own resource message for the injected failure may appear.
        const unexpected = consoleErrors.filter(
          (text) =>
            !text.includes('Failed to load resource') &&
            !(failure === 'forged-token' && /authentication|auth token|Auth/i.test(text)),
        );
        expect(unexpected).toEqual([]);
      },
    );
  }
});
