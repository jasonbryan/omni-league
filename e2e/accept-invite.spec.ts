// Accepting a staff invite (#70): `/invites/accept#<token>`, a Client route (approved design
// design/mockups/70-accept-invite.html). The token is a bearer secret in the fragment: the tests
// check that it reaches no request URL, `Referer`, address bar, or `returnTo`, that sign-up and
// sign-in bring the visitor back to the page, and that the membership is created for the leagues
// the invite named. Invites are seeded with a known token (`testing:addInvite`), so the tests need
// the local Convex backend and are skipped with E2E_BASE_URL set.
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
 * Records every request URL, `Referer`, and address-bar URL the page produces, so a test can check
 * that none holds the token (the websocket carries the token as a Convex argument, which is not a
 * URL and is not recorded here).
 *
 * The link itself is `/invites/accept#<token>`: the first address-bar URL holds the fragment, as
 * the visitor opened it, and Playwright reports a request URL with its fragment, which no request
 * carries. So a request is judged without its fragment, a `Referer` and every later address-bar
 * URL in full.
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
      // Skips the navigation to the link itself, which is the one that holds the fragment.
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
  // The fragment is gone from the router and the address bar before the page renders.
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

    // The top bar's Sign in carries the page's own path, not the token.
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

    // The membership is for Coed 7v7 Rec only: the organization is listed, and its admin area is not
    // open to a league organizer.
    await main(page).getByRole('link', { name: 'Go to your organizations' }).click();
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(main(page)).toContainText(tenant.name);
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
    await page.goto(`/app/organizations/${tenant.slug}`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
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
    // Nothing was written.
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
    // The session is deleted.
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
    // Still a league organizer: the invite did not change the role.
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

  test('an expired invite shows the same invalid view', async ({ page }) => {
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

  test('a token in the query string is never read, and is dropped from the URL', async ({
    page,
  }) => {
    const tenant = await seedOrganization();
    const token = await seedInvite(tenant, { email: newUser('Query').email });
    await page.goto(`/invites/accept?token=${token}`);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      'This invite link can’t be used',
    );
  });
});
