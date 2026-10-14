import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant, type Tenant } from './support/tenant';
import { accountByEmail, newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const DAY = 24 * 60 * 60 * 1000;
const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
];
const LEAGUES = [
  { name: 'Coed 7v7 Rec', sport: 'soccer' as const, locations: ['Redfish Flats Fields'] },
  { name: 'Sand 2s', sport: 'beachVolleyball' as const, locations: ['Redfish Flats Fields'] },
];

const main = (page: Page) => page.getByRole('main');
const newToken = () => randomBytes(32).toString('base64url');

async function seedOrganization(): Promise<Tenant> {
  return seedTenant({ name: 'E2E Accept', locations: LOCATIONS, leagues: LEAGUES });
}

async function seedInvite(
  tenant: Tenant,
  options: {
    email: string;
    role?: 'orgAdmin' | 'leagueOrganizer';
    leagueNames?: string[];
    expiresAt?: number;
  },
): Promise<string> {
  const token = newToken();
  const role = options.role ?? 'leagueOrganizer';
  await convexRun('testing:addInvite', {
    organizationSlug: tenant.slug,
    email: options.email,
    role,
    leagueNames: role === 'orgAdmin' ? [] : (options.leagueNames ?? ['Coed 7v7 Rec']),
    expiresAt: options.expiresAt ?? Date.now() + 12 * DAY,
    token,
  });
  return token;
}

/**
 * The websocket carries the token as a Convex argument, which is not a URL, so it is not recorded.
 * Playwright reports a request URL with its fragment, which no request carries, so a request is
 * judged without it; a `Referer` and every later address-bar URL in full.
 */
function watchUrls(page: Page) {
  const requests: string[] = [];
  const navigations: string[] = [];
  page.on('request', (request) => {
    requests.push(request.url().split('#')[0] ?? '');
    const referer = request.headers()['referer'];
    if (referer) requests.push(referer);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  const sent: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => sent.push(String(frame.payload))),
  );
  return {
    requests,
    navigations,
    sent,
    expectNone(token: string) {
      expect(requests.filter((url) => url.includes(token))).toEqual([]);
      // Skips the navigation to the link itself, which holds the fragment.
      expect(navigations.slice(1).filter((url) => url.includes(token))).toEqual([]);
    },
  };
}

const storedToken = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem('omni.invite-token'));

async function signInWith(page: Page, user: TestUser) {
  const tokens = tokensSettled(page);
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await tokens;
}

async function openLink(page: Page, token: string) {
  const response = await page.goto(`/invites/accept#${token}`);
  await expect(page).toHaveURL(`${baseURL}/invites/accept`);
  return response;
}

test.describe('Accept invite: a visitor with no account', () => {
  test('signs up with the invited email, accepts, and holds the league organizer role for its league only; the token reaches no URL', async ({
    page,
  }, testInfo) => {
    const tenant = await seedOrganization();
    const user = newUser('Invitee');
    const token = await seedInvite(tenant, { email: user.email });
    const urls = watchUrls(page);

    const response = await openLink(page, token);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(await storedToken(page)).toBe(token);

    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${tenant.name}`);
    await expect(page).toHaveTitle('Staff invite | Omni League');
    await expect(main(page).locator('dl')).toContainText('League organizer');
    await expect(main(page).locator('dl')).toContainText('Coed 7v7 Rec');
    await expect(main(page).locator('dl')).not.toContainText(user.email);
    await screenshot(page, testInfo, '70-signed-out');
    await expectAccessible(page);

    await expect(page.locator('header a[href^="/sign-in"]')).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Finvites%2Faccept',
    );

    await main(page).getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-up?returnTo=%2Finvites%2Faccept`);
    const tokens = tokensSettled(page);
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}/invites/accept`, { timeout: 20_000 });
    await tokens;

    const accept = main(page).getByRole('button', { name: 'Accept invite' });
    await expect(accept).toBeVisible();
    await expect(main(page)).toContainText(`Signed in as ${user.name}.`);
    await screenshot(page, testInfo, '70-ready');
    await expectAccessible(page);

    await accept.click();
    const heading = main(page).getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(`You’re on the staff of ${tenant.name}`);
    await expect(heading).toBeFocused();
    await expect(main(page)).toContainText('You’re a league organizer for Coed 7v7 Rec.');
    expect(await storedToken(page)).toBeNull();
    await expect(page).toHaveTitle('Invite accepted | Omni League');
    await screenshot(page, testInfo, '70-accepted');
    await expectAccessible(page);

    const open = main(page).getByRole('link', { name: 'Open Coed 7v7 Rec' });
    await expect(open).toHaveAttribute(
      'href',
      `/app/organizations/${tenant.slug}/leagues/coed-7v7-rec`,
    );
    await open.click();
    await expect(page).toHaveURL(
      `${baseURL}/app/organizations/${tenant.slug}/leagues/coed-7v7-rec`,
    );
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Coed 7v7 Rec');
    await page.goto(`/app/organizations/${tenant.slug}`);
    await expect(main(page)).toContainText('You can’t manage this organization');

    urls.expectNone(token);
    expect(page.url()).not.toContain(token);
  });

  test('an org admin invite reads Org admin, has no League row, and makes the visitor an org admin', async ({
    page,
  }, testInfo) => {
    const tenant = await seedOrganization();
    const user = newUser('InviteeAdmin');
    await seedUser(user);
    const token = await seedInvite(tenant, { email: user.email, role: 'orgAdmin' });
    await openLink(page, token);
    await expect(main(page).locator('dl')).toContainText('Org admin');
    await expect(main(page).locator('dl')).not.toContainText('League');
    await screenshot(page, testInfo, '70-signed-out-admin');
    await expectAccessible(page);

    await main(page).getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Finvites%2Faccept`);
    await signInWith(page, user);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(main(page)).toContainText('You’re an org admin.');
    const open = main(page).getByRole('link', { name: `Open ${tenant.name}` });
    await expect(open).toHaveAttribute('href', `/app/organizations/${tenant.slug}`);
    await open.click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/${tenant.slug}`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test.describe('Accept invite: while the invite is checked', () => {
  test('shows a skeleton of the invite card with a "Checking your invite…" status and no spinner, then the invite', async ({
    page,
  }, testInfo) => {
    const tenant = await seedOrganization();
    const token = await seedInvite(tenant, { email: newUser('Checking').email });
    // Convex applies transitions in order, so holding the answer to getByToken holds every frame
    // after it.
    interface Change {
      type: string;
      queryId: number;
      udfPath?: string;
    }
    const changes = (message: string | Buffer): Change[] =>
      (JSON.parse(String(message)) as { modifications?: Change[] }).modifications ?? [];
    let inviteQuery: number | undefined;
    let holding = false;
    const held: (string | Buffer)[] = [];
    let release: () => void = () => undefined;
    await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        for (const change of changes(message)) {
          if (change.type === 'Add' && change.udfPath === 'invites:getByToken') {
            inviteQuery = change.queryId;
          }
        }
        server.send(message);
      });
      release = () => {
        holding = false;
        for (const frame of held.splice(0)) ws.send(frame);
      };
      server.onMessage((message) => {
        const answersInvite = changes(message).some(
          (change) => change.type === 'QueryUpdated' && change.queryId === inviteQuery,
        );
        if (answersInvite) holding = true;
        if (holding) held.push(message);
        else ws.send(message);
      });
    });

    await page.addInitScript(() => {
      const shifts = { score: 0 };
      (window as unknown as { shifts: typeof shifts }).shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!shift.hadRecentInput) shifts.score += shift.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await openLink(page, token);
    const skeleton = main(page).getByTestId('invite-skeleton');
    await expect(skeleton).toBeVisible();
    await expect.poll(() => holding).toBe(true);
    await expect(skeleton.getByRole('status')).toHaveText('Checking your invite…');
    await expect(skeleton.getByRole('status')).toHaveClass(/sr-only/);
    await expect(main(page).locator('[class*="animate-spin"]')).toHaveCount(0);
    await expect(main(page).getByRole('heading')).toHaveCount(0);
    await screenshot(page, testInfo, '212-checking');
    await expectAccessible(page);
    const before = await skeleton.boundingBox();

    release();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${tenant.name}`);
    await expect(skeleton).toHaveCount(0);

    // Only the height can change: the lead line may wrap and the sign-in prompt is longer.
    const card = main(page).locator('.ring-1').first();
    const after = await card.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after?.x).toBeCloseTo(before?.x ?? -1, 0);
    expect(after?.y).toBeCloseTo(before?.y ?? -1, 0);
    expect(after?.width).toBeCloseTo(before?.width ?? -1, 0);
    const score = await page.evaluate(
      () => (window as unknown as { shifts: { score: number } }).shifts.score,
    );
    testInfo.annotations.push({ type: 'layout shift score', description: String(score) });
    expect(score).toBeLessThan(0.1);
    testInfo.annotations.push({
      type: 'card height',
      description: `skeleton ${before?.height}, loaded ${after?.height}`,
    });
  });
});

test.describe('Accept invite: a different account', () => {
  test.use({ expectedConvexErrors: ['invites:accept'] });

  test('a different email is refused; "Sign in with a different account" signs out and keeps the token out of every URL; the invited address then accepts', async ({
    page,
  }, testInfo) => {
    const tenant = await seedOrganization();
    const wrong = newUser('Wrong');
    const invited = await seedUser(newUser('Invited'));
    await signUp(page, wrong);
    const token = await seedInvite(tenant, { email: invited.email });
    const urls = watchUrls(page);

    await openLink(page, token);
    const accept = main(page).getByRole('button', { name: 'Accept invite' });
    await expect(accept).toBeVisible();
    await accept.click();

    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('This invite was sent to a different email address.');
    await expect(alert).toContainText('Sign in with that address to accept it.');
    await expect(alert).toBeFocused();
    await screenshot(page, testInfo, '70-different-email');
    await expectAccessible(page);
    await page.goto('/app');
    await expect(main(page)).not.toContainText(tenant.name);
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await expect(main(page).getByRole('button', { name: 'Accept invite' })).toBeVisible();
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(alert).toBeFocused();

    await main(page).getByRole('button', { name: 'Sign in with a different account' }).click();
    await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Finvites%2Faccept`);
    expect(await storedToken(page)).toBe(token);
    await expect.poll(async () => (await accountByEmail(wrong.email))?.sessions).toBe(0);

    await signInWith(page, invited);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      `You’re on the staff of ${tenant.name}`,
    );
    expect(await storedToken(page)).toBeNull();
    urls.expectNone(token);
  });

  test('a visitor who is already a member is refused and keeps one membership', async ({
    page,
  }, testInfo) => {
    const tenant = await seedOrganization();
    const user = newUser('Member');
    await signUp(page, user);
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'leagueOrganizer',
    });
    const token = await seedInvite(tenant, { email: user.email, role: 'orgAdmin' });
    await openLink(page, token);
    await main(page).getByRole('button', { name: 'Accept invite' }).click();

    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText(`You’re already on the staff of ${tenant.name}.`);
    await expect(alert).toBeFocused();
    await expect(main(page).getByRole('button')).toHaveCount(0);
    await expect(
      main(page).getByRole('link', { name: 'Go to your organizations' }),
    ).toHaveAttribute('href', '/app');
    await screenshot(page, testInfo, '70-already-member');
    await expectAccessible(page);
    await page.goto(`/app/organizations/${tenant.slug}`);
    await expect(main(page)).toContainText('You can’t manage this organization');
  });
});

test.describe('Accept invite: links that cannot be used', () => {
  test('no fragment and nothing stored: the invalid view, and getByToken is never asked', async ({
    page,
  }, testInfo) => {
    const urls = watchUrls(page);
    await page.goto('/invites/accept');
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      'This invite link can’t be used',
    );
    await expect(page).toHaveTitle('Invite unavailable | Omni League');
    await screenshot(page, testInfo, '70-invalid');
    await expectAccessible(page);
    await page.waitForTimeout(500);
    expect(urls.sent.filter((frame) => frame.includes('invites:getByToken'))).toEqual([]);
    await expect(main(page).getByRole('link', { name: 'Go to the home page' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  test('an expired invite shows the same invalid view', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const tenant = await seedOrganization();
    const token = await seedInvite(tenant, {
      email: newUser('Late').email,
      expiresAt: Date.now() - 1000,
    });
    await openLink(page, token);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      'This invite link can’t be used',
    );
    expect(await storedToken(page)).toBeNull();
  });

  test(
    'a fragment opened on the invite page that is already open is captured too: the address bar and returnTo never hold the token',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedOrganization();
      const token = await seedInvite(tenant, { email: newUser('Again').email });
      const urls = watchUrls(page);

      await page.goto('/invites/accept');
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );

      await page.goto(`/invites/accept#${token}`);
      await expect(page).toHaveURL(`${baseURL}/invites/accept`);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${tenant.name}`);
      expect(await storedToken(page)).toBe(token);
      expect(page.url()).not.toContain(token);
      expect(page.url()).not.toContain('#');
      const afterCapture = urls.navigations.length;

      const links = page.locator('a[href^="/sign-in"], a[href^="/sign-up"]');
      expect(await links.count()).toBeGreaterThan(0);
      for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')))) {
        expect(href).not.toContain(token);
        expect(href).not.toContain('#');
        expect(href).not.toContain('%23');
      }
      await page.locator('header a[href^="/sign-in"]').click();
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Finvites%2Faccept`);
      expect(urls.requests.filter((url) => url.includes(token))).toEqual([]);
      expect(urls.navigations.slice(afterCapture).filter((url) => url.includes('#'))).toEqual([]);
      expect(urls.navigations.slice(afterCapture).filter((url) => url.includes(token))).toEqual([]);
    },
  );

  test(
    'a token in the query string is never read, and is dropped from the URL',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedOrganization();
      const token = await seedInvite(tenant, { email: newUser('Query').email });
      await page.goto(`/invites/accept?token=${token}`);
      await expect(page).toHaveURL(`${baseURL}/invites/accept`);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );
    },
  );
});

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

async function expectNoTokenShown(page: Page, tokens: string[]) {
  for (const token of tokens) {
    expect(page.url()).not.toContain(token);
    expect(page.url()).not.toContain('#');
  }
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    for (const token of tokens) expect(href).not.toContain(token);
    // The skip link's fragment is short and `#main`-like; a token-shaped or encoded fragment is a
    // leak.
    expect(href).not.toMatch(/#[A-Za-z0-9_-]{20,}/);
    expect(href).not.toContain('%23');
  }
}

test.describe('Accept invite: a link opened on the page that is already open', () => {
  test(
    'two links in sequence, then back and forward: the second replaces the first and neither token is ever in the address bar, a link, or a request',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const first = await seedOrganization();
      const second = await seedOrganization();
      const tokenA = await seedInvite(first, { email: newUser('SeqA').email });
      const tokenB = await seedInvite(second, { email: newUser('SeqB').email });
      const urls = watchUrls(page);

      await openLink(page, tokenA);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${first.name}`);
      await expectNoTokenShown(page, [tokenA, tokenB]);

      await page.goto(`/invites/accept#${tokenB}`);
      await expect(page).toHaveURL(`${baseURL}/invites/accept`);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${second.name}`);
      expect(await storedToken(page)).toBe(tokenB);
      await expectNoTokenShown(page, [tokenA, tokenB]);
      const afterSecond = urls.navigations.length;

      await page.goto(`/invites/accept#${tokenA}`);
      await expect(page).toHaveURL(`${baseURL}/invites/accept`);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${first.name}`);
      expect(await storedToken(page)).toBe(tokenA);
      await expectNoTokenShown(page, [tokenA, tokenB]);
      const afterThird = urls.navigations.length;

      for (const move of ['back', 'forward', 'back', 'back', 'forward', 'forward'] as const) {
        if (move === 'back') await page.goBack();
        else await page.goForward();
        await page.waitForTimeout(300);
        await expectNoTokenShown(page, [tokenA, tokenB]);
        expect(await storedToken(page)).toBe(tokenA);
      }
      expect(urls.navigations.slice(afterThird).filter((url) => url.includes('#'))).toEqual([]);
      expect(
        urls.navigations
          .slice(afterSecond)
          .filter((url) => url.includes(tokenA) && !url.includes('#')),
      ).toEqual([]);

      await page.locator('header a[href^="/sign-in"]').click();
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Finvites%2Faccept`);
      expect(urls.requests.filter((url) => url.includes(tokenA) || url.includes(tokenB))).toEqual(
        [],
      );
    },
  );

  test(
    'assigning location.hash and pressing a hash link on the open page are captured too',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedOrganization();
      const token = await seedInvite(tenant, { email: newUser('Hash').email });
      const urls = watchUrls(page);
      await page.goto('/invites/accept');
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );

      await page.evaluate((t) => {
        location.hash = t;
      }, token);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${tenant.name}`);
      await expectNoTokenShown(page, [token]);
      expect(await storedToken(page)).toBe(token);

      await page.evaluate((t) => {
        location.hash = t;
      }, token);
      await page.waitForTimeout(300);
      await expectNoTokenShown(page, [token]);
      expect(urls.requests.filter((url) => url.includes(token))).toEqual([]);
      expect(
        urls.navigations.filter((url) => url.includes(token) && url.split('#').length > 2),
      ).toEqual([]);
    },
  );

  test.describe('signed in', () => {
    test.use({ expectedConvexErrors: ['invites:accept'] });

    test(
      'a link opened on the open page replaces a refused invite with the new one, which can be accepted',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const first = await seedOrganization();
        const second = await seedOrganization();
        const user = newUser('Live');
        await signUp(page, user);
        const stranger = await seedInvite(first, { email: newUser('Else').email });
        const mine = await seedInvite(second, { email: user.email });
        const urls = watchUrls(page);

        await openLink(page, stranger);
        await main(page).getByRole('button', { name: 'Accept invite' }).click();
        await expect(main(page).getByRole('alert')).toContainText(
          'This invite was sent to a different email address.',
        );

        await page.goto(`/invites/accept#${mine}`);
        await expect(page).toHaveURL(`${baseURL}/invites/accept`);
        await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
          `Join ${second.name}`,
        );
        await expect(main(page).getByRole('alert')).toHaveCount(0);
        await expect(
          main(page).getByRole('button', { name: 'Sign in with a different account' }),
        ).toHaveCount(0);
        expect(await storedToken(page)).toBe(mine);
        await expectNoTokenShown(page, [stranger, mine]);

        await main(page).getByRole('button', { name: 'Accept invite' }).click();
        await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
          `You’re on the staff of ${second.name}`,
        );
        expect(await storedToken(page)).toBeNull();

        await page.goto(`/invites/accept#${mine}`);
        await expect(page).toHaveURL(`${baseURL}/invites/accept`);
        await page.waitForTimeout(500);
        test.info().annotations.push({
          type: 'after-reopen',
          description: `heading=${await main(page).getByRole('heading', { level: 1 }).textContent()} stored=${(await storedToken(page)) === null ? 'null' : 'token'}`,
        });
        await expectNoTokenShown(page, [stranger, mine]);
        await page.reload();
        await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
          'This invite link can’t be used',
        );
        expect(await storedToken(page)).toBeNull();
        expect(urls.requests.filter((url) => url.includes(stranger) || url.includes(mine))).toEqual(
          [],
        );
      },
    );
  });

  test(
    'a malformed fragment on the open page is dropped and shows the invalid view',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedOrganization();
      const token = await seedInvite(tenant, { email: newUser('Bad').email });
      await openLink(page, token);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Join ${tenant.name}`);
      await page.goto('/invites/accept#not%20a%20token!');
      await expect(page).toHaveURL(`${baseURL}/invites/accept`);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );
      expect(await storedToken(page)).toBeNull();
      await expectNoTokenShown(page, [token]);
    },
  );
});

test.describe('Accept invite: the invite could not be loaded', () => {
  test('shows the temporarily-unavailable view; the token stays stored and appears in no URL, link, or Try again; Try again then loads the invite', async ({
    page,
  }, testInfo) => {
    const tenant = await seedOrganization();
    const token = await seedInvite(tenant, { email: newUser('Down').email });
    const urls = watchUrls(page);
    let failQuery = true;
    await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString();
        server.send(
          failQuery ? text.replaceAll('invites:getByToken', 'invites:doesNotExist') : text,
        );
      });
      server.onMessage((message) => ws.send(message));
    });

    await openLink(page, token);
    const heading = main(page).getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('This page is temporarily unavailable');
    await expect(page).toHaveTitle('Temporarily unavailable | Omni League');
    expect(await storedToken(page)).toBe(token);
    await expectNoTokenShown(page, [token]);
    const retry = main(page).getByRole('link', { name: 'Try again' });
    await expect(retry).toHaveAttribute('href', '/invites/accept');
    await screenshot(page, testInfo, '70-load-failed');
    await expectAccessible(page);

    failQuery = false;
    await retry.click();
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await expect(heading).toHaveText(`Join ${tenant.name}`);
    expect(await storedToken(page)).toBe(token);
    await expectNoTokenShown(page, [token]);
    expect(urls.requests.filter((url) => url.includes(token))).toEqual([]);
    expect(urls.navigations.slice(1).filter((url) => url.includes(token))).toEqual([]);
  });
});

test.describe('Accept invite: offline and a spent token', () => {
  test('offline, Accept invite is aria-disabled at half opacity and still focusable; a press shows the offline alert and sends nothing; back online it accepts', async ({
    page,
    context,
  }, testInfo) => {
    // While offline the Convex socket closes at once, so Chromium logs no connection error for it.
    let offline = false;
    await context.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
      if (offline) void ws.close();
      else ws.connectToServer();
    });
    const tenant = await seedOrganization();
    const user = newUser('Offline');
    await signUp(page, user);
    const token = await seedInvite(tenant, { email: user.email });
    const urls = watchUrls(page);

    await openLink(page, token);
    const accept = main(page).getByRole('button', { name: 'Accept invite' });
    await expect(accept).toBeVisible();
    await expect(accept).not.toHaveAttribute('aria-disabled', /.*/);
    await expect(accept).toHaveCSS('opacity', '1');

    offline = true;
    await context.setOffline(true);
    await expect(accept).toHaveAttribute('aria-disabled', 'true', { timeout: 2_000 });
    await expect(accept).toHaveCSS('opacity', '0.5');
    await expect(accept).not.toHaveAttribute('disabled', /.*/);
    await accept.focus();
    await expect(accept).toBeFocused();
    await screenshot(page, testInfo, '70-offline-ready');

    const sentBefore = urls.sent.length;
    const requestsBefore = urls.requests.length;
    await page.keyboard.press('Enter');
    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText("You're offline. Nothing was sent.");
    await expect(alert).toBeFocused();
    await screenshot(page, testInfo, '70-offline-alert');
    await expectAccessible(page);
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the
    // press regardless.
    await accept.click({ force: true });
    await expect(alert).toBeFocused();
    await page.waitForTimeout(500);
    expect(urls.sent.slice(sentBefore).filter((frame) => frame.includes('invites:accept'))).toEqual(
      [],
    );
    expect(urls.requests.length).toBe(requestsBefore);
    expect(await storedToken(page)).toBe(token);

    offline = false;
    await context.setOffline(false);
    await expect(accept).not.toHaveAttribute('aria-disabled', /.*/, { timeout: 20_000 });
    await expect(accept).toHaveCSS('opacity', '1');
    await accept.click();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      `You’re on the staff of ${tenant.name}`,
    );
    expect(await storedToken(page)).toBeNull();
    urls.expectNone(token);
  });

  test(
    'an invalid link reopened on the open page clears sessionStorage each time',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedOrganization();
      const token = await seedInvite(tenant, {
        email: newUser('Late').email,
        expiresAt: Date.now() - 1000,
      });
      await openLink(page, token);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );
      await expect.poll(() => storedToken(page)).toBeNull();
      for (let i = 0; i < 2; i += 1) {
        await page.evaluate((value) => {
          location.hash = value;
        }, token);
        await expect(page).toHaveURL(`${baseURL}/invites/accept`);
        await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
          'This invite link can’t be used',
        );
        await expect.poll(() => storedToken(page)).toBeNull();
      }
    },
  );

  test(
    'a spent (accepted) link reopened in the same tab shows the invalid view and clears sessionStorage',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedOrganization();
      const user = newUser('Spent');
      await signUp(page, user);
      const token = await seedInvite(tenant, { email: user.email });
      await openLink(page, token);
      await main(page).getByRole('button', { name: 'Accept invite' }).click();
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        `You’re on the staff of ${tenant.name}`,
      );
      expect(await storedToken(page)).toBeNull();
      await page.goto('/app');
      await openLink(page, token);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );
      await expect.poll(() => storedToken(page)).toBeNull();
      await page.evaluate((value) => {
        location.hash = value;
      }, token);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
        'This invite link can’t be used',
      );
      await expect.poll(() => storedToken(page)).toBeNull();
    },
  );

  test.describe('refused as already a member', () => {
    test.use({ expectedConvexErrors: ['invites:accept'] });

    test(
      'an already-a-member refusal clears sessionStorage, and the link reopened on the open page does not store it again',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const tenant = await seedOrganization();
        const user = newUser('Twice');
        await signUp(page, user);
        await convexRun('testing:addMembership', {
          organizationSlug: tenant.slug,
          email: user.email,
          role: 'leagueOrganizer',
        });
        const token = await seedInvite(tenant, { email: user.email, role: 'orgAdmin' });
        await openLink(page, token);
        await main(page).getByRole('button', { name: 'Accept invite' }).click();
        await expect(main(page).getByRole('alert')).toContainText('already on the staff');
        await expect.poll(() => storedToken(page)).toBeNull();
        await page.evaluate((value) => {
          location.hash = value;
        }, token);
        await expect(page).toHaveURL(`${baseURL}/invites/accept`);
        await page.waitForTimeout(500);
        await expect.poll(() => storedToken(page)).toBeNull();
      },
    );
  });
});
