// AuthService's session and Convex token handling in a real browser (#62 tester, after the #115
// merge). A browser with no stored session token is signed out without a get-session request; a
// stored one is asked about once; sign-out removes it. A failed or refused token request never
// authenticates the Convex client, so `users.me` never answers with a name.
import { test as base, type Page } from '@playwright/test';
import { TOKEN_PATH as TOKEN, tokensSettled } from './support/auth-tokens';
import { baseURL, LOCAL_BUILD_ONLY, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { stubNetlifyDrawer } from './support/netlify-drawer';
import { holdServiceWorkerRegistration } from './support/no-service-worker';
import { seedTenant } from './support/tenant';
import { newUser, type TestUser } from './support/users';

/** The crossDomain plugin's store in `localStorage` (`@convex-dev/better-auth`). */
const STORE_KEY = 'better-auth_cookie';
const GET_SESSION = '/api/auth/get-session';

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
  // Remote runs: the production build's service worker would hide the auth requests these tests
  // intercept and count (e2e/support/no-service-worker.ts).
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

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
    // #111: a stored session is asked about exactly once per load.
    expect(count(seen, GET_SESSION)).toBe(1);
    // Two token requests: the first, and the fresh one the Convex client asks for once the server
    // confirms it. The Convex client's second setAuth shares the first (#62 tester, round 3).
    expect(count(seen, TOKEN)).toBe(2);

    await panel(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    expect(await storesSessionToken(page)).toBe(false);
    // The sign-out response stores an empty session token; the session store's refetch removes it.
    await settle(page);
    // #111: the key may still be present after sign-out, so its presence is not the test.
    expect(await page.evaluate((key) => localStorage.getItem(key) !== null, STORE_KEY)).toBe(true);

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
    if (!remoteBaseUrl) return;
    await stubNetlifyDrawer(context);
    await holdServiceWorkerRegistration(context);
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

/**
 * Tester (#62, round 4): adversarial checks of the round-3 fixes. A corrupt store never hangs
 * fetchToken; a signed-in load makes exactly 2 token requests, one after the other; a token
 * request in flight at sign-out never authenticates Convex, before or after another user signs in.
 */
test.describe('auth session store, round 4', () => {
  // Remote runs: the production build's service worker would hide the auth requests these tests
  // intercept and count (e2e/support/no-service-worker.ts).
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  for (const raw of [
    '',
    'true',
    '0',
    '{"better-auth.session_token":"text"}',
    '{"better-auth.session_token":[]}',
    '{"better-auth.session_token":{"value":null}}',
    '{"better-auth.session_token":{"value":""}}',
    '{"better-auth.session_token":{"value":123,"expires":null}}',
    '{"better-auth.session_token":{"value":"forged","expires":"not a date"}}',
    '{"other":null,"better-auth.session_token":{"value":"forged","expires":null}}',
    `"${'x'.repeat(100_000)}"`,
  ]) {
    test(`a corrupt store value ${raw.slice(0, 80)} is signed out and the guard answers`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORE_KEY, raw]);
      const seen = authRequests(page);
      await page.goto('/app');
      await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Fapp`);
      await settle(page);
      expect(count(seen, TOKEN)).toBe(0);
      expect(count(seen, GET_SESSION)).toBeLessThanOrEqual(2);
    });
  }

  for (const raw of ['null', '{"better-auth.session_token":null}', '{"a":null}']) {
    test(`with the store value ${raw}, a public live query still gets its data`, async ({
      page,
    }) => {
      test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
      const tenant = await seedTenant({ name: 'Corrupt Store' });
      const answers: string[] = [];
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          const text = typeof payload === 'string' ? payload : payload.toString();
          if (text.includes('"Transition"') && text.includes(tenant.name)) answers.push(text);
        });
      });
      await page.goto('/');
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORE_KEY, raw]);
      await page.goto(tenant.path);
      await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
      await expect.poll(() => answers.length, { timeout: 8_000 }).toBeGreaterThan(0);
    });
  }

  test('every signed-in load makes exactly 2 token requests, one after the other', async ({
    page,
  }) => {
    const user = newUser('TwoTokens');
    const first = tokensSettled(page);
    await signUp(page, user);
    await expect(panel(page)).toContainText(user.name);
    await first;

    const events: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === TOKEN) events.push('start');
    });
    page.on('requestfinished', (r) => {
      if (new URL(r.url()).pathname === TOKEN) events.push('end');
    });
    page.on('requestfailed', (r) => {
      if (new URL(r.url()).pathname === TOKEN) events.push('failed');
    });
    for (const load of [
      () => page.reload(),
      () => page.goto('/'),
      () => page.goto('/app'),
      () => page.reload(),
      () => page.goto(`/sign-up?returnTo=${encodeURIComponent('/app')}`),
    ]) {
      events.length = 0;
      await load();
      // Wait for both, then for a spell in which a third request would show: on a preview, the
      // server's confirmation of the first token can take more than a second.
      await expect.poll(() => events.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
      await page.waitForTimeout(1_500);
      expect(events).toEqual(['start', 'end', 'start', 'end']);
    }
  });

  test('several tabs that load at once each make exactly 2 token requests', async ({
    context,
    page,
  }) => {
    const user = newUser('Tabs');
    const first = tokensSettled(page);
    await signUp(page, user);
    await expect(panel(page)).toContainText(user.name);
    await first;

    const tabs = await Promise.all(Array.from({ length: 4 }, () => context.newPage()));
    const perTab = tabs.map((tab) => ({ tab, seen: authRequests(tab) }));
    await Promise.all(perTab.map(({ tab }) => tab.goto('/app')));
    await Promise.all(perTab.map(({ tab }) => expect(panel(tab)).toContainText(user.name)));
    for (const { seen } of perTab) {
      await expect.poll(() => count(seen, TOKEN), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    }
    await page.waitForTimeout(1_500);
    for (const { seen } of perTab) expect(count(seen, TOKEN)).toBe(2);
  });

  test('a token request in flight at sign-out never authenticates Convex, even after another user signs in', async ({
    page,
  }) => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
    const alice = newUser('HeldAlice');
    const bob = newUser('HeldBob');
    const first = tokensSettled(page);
    await signUp(page, alice);
    await expect(panel(page)).toContainText(alice.name);
    await first;

    // Hold the second token request of the next load (the Convex client's forced refresh) with
    // Alice's real token in it, until after she signs out and Bob signs in.
    let intercepted = 0;
    let heldToken = '';
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => (release = resolve));
    let markHeld: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (markHeld = resolve));
    let markDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (markDone = resolve));
    await page.route(
      (url) => url.pathname === TOKEN,
      async (route) => {
        intercepted += 1;
        if (intercepted !== 2) return route.continue();
        const response = await route.fetch();
        heldToken = ((await response.json()) as { token: string }).token;
        markHeld();
        await released;
        await route.fulfill({ response });
        markDone();
      },
    );
    const authFramesAfterRelease: string[] = [];
    let afterRelease = false;
    const aliceAnswers: string[] = [];
    let afterSignOut = false;
    page.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => {
        const text = typeof payload === 'string' ? payload : payload.toString();
        if (afterRelease && text.includes('"Authenticate"')) authFramesAfterRelease.push(text);
      });
      socket.on('framereceived', ({ payload }) => {
        const text = typeof payload === 'string' ? payload : payload.toString();
        if (afterSignOut && text.includes(alice.name)) aliceAnswers.push(text);
      });
    });

    await page.reload();
    await expect(panel(page)).toContainText(alice.name);
    await held;
    expect(heldToken).not.toBe('');

    afterSignOut = true;
    await panel(page).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);

    // Client-side navigation keeps this document, so the held request stays in flight.
    await page.evaluate(() => {
      history.pushState(null, '', '/sign-up');
      dispatchEvent(new PopStateEvent('popstate', { state: null }));
    });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
    await page.locator('#name').fill(bob.name);
    await page.locator('#email').fill(bob.email);
    await page.locator('#password').fill(bob.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(panel(page)).toContainText(bob.name);
    // Bob's tokens were new requests, not Alice's held one.
    expect(intercepted).toBeGreaterThanOrEqual(3);

    afterRelease = true;
    release();
    await done;
    await page.waitForTimeout(3_000);
    await expect(panel(page)).toContainText(bob.name);
    expect(aliceAnswers).toEqual([]);
    expect(authFramesAfterRelease.filter((frame) => frame.includes(heldToken))).toEqual([]);
  });
});

base.describe('auth token failures, round 4', () => {
  base.beforeEach(async ({ context }) => {
    if (!remoteBaseUrl) return;
    await stubNetlifyDrawer(context);
    await holdServiceWorkerRegistration(context);
  });

  for (const failure of ['network', 'http-500'] as const) {
    base(
      `a slow ${failure} token request is shared by both setAuth calls and never authenticates Convex`,
      async ({ page }) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const user = newUser('SlowFail');
        const first = tokensSettled(page);
        await signUp(page, user);
        await expect(panel(page)).toContainText(user.name);
        await first;

        const starts: number[] = [];
        await page.route(
          (url) => url.pathname === TOKEN,
          async (route) => {
            starts.push(Date.now());
            // Slow enough that the Convex client's second setAuth call starts while it waits.
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            if (failure === 'network') return route.abort('failed');
            return route.fulfill({
              status: 500,
              headers: {
                'access-control-allow-origin': new URL(baseURL).origin,
                'access-control-allow-credentials': 'true',
                'content-type': 'application/json',
              },
              body: '{"message":"boom"}',
            });
          },
        );
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
        await page.waitForTimeout(5_000);
        await expect(panel(page)).toHaveCount(0);
        // Both setAuth calls share the first (slow) request; the Convex client's own forced
        // refetch after a null token is the second. Unshared, the first two would start together.
        expect(starts).toHaveLength(2);
        expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_400);
        expect(pageErrors).toEqual([]);
      },
    );
  }
});

test.describe('auth token refresh, round 4', () => {
  // Remote runs: the production build's service worker would hide the auth requests these tests
  // intercept and count (e2e/support/no-service-worker.ts).
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  // The second token request of a signed-in load is the Convex client's forced refresh
  // (forceRefreshToken: true, once the server confirms the first token). A cache that answered
  // it would make one request, and the client would never authenticate with a fresh token.
  test('the forced refresh makes its own request, and Convex authenticates with its token', async ({
    page,
  }) => {
    const user = newUser('Refresh');
    const first = tokensSettled(page);
    await signUp(page, user);
    await expect(panel(page)).toContainText(user.name);
    await first;

    // Each token's response; the Convex client sends the last one it fetched.
    const tokens: string[] = [];
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname !== TOKEN || response.status() !== 200) return;
      tokens.push(((await response.json()) as { token: string }).token);
    });
    const authenticated: string[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => {
        const text = typeof payload === 'string' ? payload : payload.toString();
        if (!text.includes('"Authenticate"')) return;
        const message = JSON.parse(text) as { value?: string };
        if (message.value) authenticated.push(message.value);
      });
    });
    const settled = tokensSettled(page);
    await page.reload();
    await expect(panel(page)).toContainText(user.name);
    await settled;
    await expect.poll(() => tokens.length).toBe(2);
    await expect.poll(() => authenticated.at(-1)).toBe(tokens[1]);
  });
});
