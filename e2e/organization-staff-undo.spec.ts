// Undo on the Staff page's revoked status. The window's edges are Convex tests; the page's own timer
// for hiding Undo runs on the browser clock. Each test signs up
// its own org admin and seeds the invite with a known token (`testing:addInvite`), so the tests
// need the local Convex backend and are skipped with E2E_BASE_URL set.
import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { INVITE_MESSAGES } from '../convex/lib/inviteInput';
import { expectAccessible, tabKey } from './support/a11y';
import { convexRun } from './support/convex';
import { TOKEN_PATH } from './support/auth-tokens';
import { LOCAL_CONVEX_URL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const DAY = 24 * 60 * 60 * 1000;
/**
 * Rounds per race: each makes several HTTP calls, so many rounds pass the 30 s test timeout on a
 * 2-vCPU runner. The Convex tests cover the races in depth; these prove them once end to end.
 */
const RACE_ROUNDS = 2;
const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
];
const LEAGUES = [
  { name: 'Coed 7v7 Rec', sport: 'soccer' as const, locations: ['Redfish Flats Fields'] },
];

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

const main = (page: Page) => page.getByRole('main');
const pendingRows = (page: Page) => page.locator('#pending-list > li');

interface OpenOptions {
  /** Further invites, in the order they list after `email`. */
  otherEmails?: string[];
  /** Runs once signed in, before `/staff` loads: the place for a socket route or the clock. */
  beforeOpen?: () => Promise<void>;
}

/** An org admin signed in on `/staff` of a new organization holding one invite with a known token. */
async function openStaffWithInvite(page: Page, email: string, options: OpenOptions = {}) {
  const admin = newUser('Admin');
  await signUp(page, admin);
  const tenant = await seedTenant({ name: 'E2E Undo', locations: LOCATIONS, leagues: LEAGUES });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: admin.email,
    role: 'orgAdmin',
  });
  const token = randomBytes(32).toString('base64url');
  await convexRun('testing:addInvite', {
    organizationSlug: tenant.slug,
    email,
    role: 'orgAdmin',
    expiresAt: Date.now() + 14 * DAY,
    token,
  });
  for (const other of options.otherEmails ?? []) {
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: other,
      role: 'orgAdmin',
      expiresAt: Date.now() + 14 * DAY,
      token: randomBytes(32).toString('base64url'),
    });
  }
  await options.beforeOpen?.();
  await page.goto(`/app/organizations/${tenant.slug}/staff`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await expect(pendingRows(page)).toHaveCount(1 + (options.otherEmails?.length ?? 0));
  return { tenant, token };
}

const revokeButton = (page: Page, email: string) =>
  page.getByRole('button', { name: `Revoke the invite to ${email}` });
const undoButton = (page: Page, email: string) =>
  page.getByRole('button', { name: `Undo revoking the invite to ${email}` });

function requestIdOf(frame: string | Buffer, udfPath: string): number | null {
  try {
    const parsed = JSON.parse(frame.toString()) as {
      type?: string;
      udfPath?: string;
      requestId?: number;
    };
    const wanted = parsed.type === 'Mutation' && parsed.udfPath === udfPath;
    return wanted && parsed.requestId !== undefined ? parsed.requestId : null;
  } catch {
    return null;
  }
}

/**
 * Answers or holds the page's calls to one mutation on its Convex socket. `plainServerError` is
 * what a function that throws a plain `Error` sends in production: no reason, only "Server Error".
 * `refused` is a `ConvexError` the page reads, and `hold` keeps the call from the server until
 * `release()`.
 */
async function interceptMutation(
  page: Page,
  udfPath: string,
  handling: 'plainServerError' | 'refused' | 'hold',
) {
  let release: () => void = () => undefined;
  await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((frame) => {
      const requestId = requestIdOf(frame, udfPath);
      if (requestId === null) {
        server.send(frame);
      } else if (handling === 'hold') {
        release = () => server.send(frame);
      } else {
        const failure = { type: 'MutationResponse', requestId, success: false, logLines: [] };
        const errorData = { code: 'notPending', message: INVITE_MESSAGES.revokeNotPending };
        ws.send(
          JSON.stringify(
            handling === 'refused'
              ? { ...failure, result: 'ConvexError', errorData }
              : { ...failure, result: 'Server Error' },
          ),
        );
      }
    });
    server.onMessage((frame) => ws.send(frame));
  });
  return { release: () => release() };
}

/** Opens the invite link in another tab of the same browser and returns that tab's heading. */
async function inviteLinkHeading(page: Page, token: string) {
  const tab = await page.context().newPage();
  await tab.goto(`/invites/accept#${token}`);
  return { tab, heading: main(tab).getByRole('heading', { level: 1 }) };
}

test.describe('Staff: undoing a revoke', () => {
  test('Undo restores the invite: the row returns, the status takes focus, and the original link opens the accept page again', async ({
    page,
  }, testInfo) => {
    const email = 'dana@example.com';
    const { tenant, token } = await openStaffWithInvite(page, email);

    await revokeButton(page, email).click();
    const revoked = page.getByRole('status').filter({ hasText: `Invite to ${email} revoked.` });
    await expect(revoked).toBeFocused();
    await expect(undoButton(page, email)).toBeVisible();
    // Touch targets are 44px or more on touch screens (docs/conventions/ux.md, Layout).
    if (testInfo.project.name === 'chromium-mobile') {
      expect((await undoButton(page, email).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(pendingRows(page)).toHaveCount(0);
    await screenshot(page, testInfo, '211-staff-undo-offered');
    await expectAccessible(page);

    const before = await inviteLinkHeading(page, token);
    await expect(before.heading).toHaveText('This invite link can’t be used');
    await before.tab.close();

    await undoButton(page, email).click();
    const restored = page
      .getByRole('status')
      .filter({ hasText: `Invite to ${email} restored. Its link works again.` });
    await expect(restored).toBeFocused();
    await expect(undoButton(page, email)).toHaveCount(0);
    await expect(pendingRows(page)).toHaveCount(1);
    await expect(pendingRows(page).first().locator('h3')).toHaveText(email);
    await screenshot(page, testInfo, '211-staff-restored');
    await expectAccessible(page);

    const after = await inviteLinkHeading(page, token);
    await expect(after.heading).toHaveText(`Join ${tenant.name}`);
    await after.tab.close();
  });

  test('a keyboard alone revokes an invite and then activates Undo', async ({ page }) => {
    const email = 'erin@example.com';
    const { tenant, token } = await openStaffWithInvite(page, email);

    // No pointer input from here on: focus the button, then Enter, Tab, and Space.
    const tab = tabKey(page);
    await revokeButton(page, email).focus();
    await page.keyboard.press('Enter');
    const revoked = page.getByRole('status').filter({ hasText: `Invite to ${email} revoked.` });
    await expect(revoked).toBeFocused();

    await page.keyboard.press(tab);
    await expect(undoButton(page, email)).toBeFocused();
    await page.keyboard.press('Space');

    const restored = page.getByRole('status').filter({ hasText: `Invite to ${email} restored.` });
    await expect(restored).toBeFocused();
    await expect(pendingRows(page)).toHaveCount(1);
    await page.keyboard.press(tab);
    await expect(revokeButton(page, email)).toBeFocused();

    const link = await inviteLinkHeading(page, token);
    await expect(link.heading).toHaveText(`Join ${tenant.name}`);
    await link.tab.close();
  });

  test.describe('a server error with no reason on Undo', () => {
    test.use({ expectedConvexErrors: ['invites:restore'] });

    test('ends the offer and says what to do, without blaming the connection', async ({
      page,
    }, testInfo) => {
      const email = 'dana@example.com';
      await openStaffWithInvite(page, email, {
        beforeOpen: async () => {
          await interceptMutation(page, 'invites:restore', 'plainServerError');
        },
      });
      await revokeButton(page, email).click();
      await undoButton(page, email).click();
      const failed = page
        .getByRole('alert')
        .filter({ hasText: 'The invite could not be restored.' });
      await expect(failed).toBeFocused();
      await expect(failed).toContainText(
        'The invite stays revoked. Reload the page, then invite this address again.',
      );
      await expect(main(page)).not.toContainText('Check your connection');
      await expect(undoButton(page, email)).toHaveCount(0);
      await screenshot(page, testInfo, '228-staff-undo-server-error');
      await expectAccessible(page);
    });
  });

  test.describe('a failed Revoke', () => {
    test.use({ expectedConvexErrors: ['invites:revoke'] });

    test('says the invite is unchanged, without blaming the connection, and Revoke stays', async ({
      page,
    }, testInfo) => {
      const email = 'erin@example.com';
      await openStaffWithInvite(page, email, {
        beforeOpen: async () => {
          await interceptMutation(page, 'invites:revoke', 'plainServerError');
        },
      });
      await revokeButton(page, email).click();
      const failed = page
        .getByRole('alert')
        .filter({ hasText: 'The invite could not be revoked.' });
      await expect(failed).toBeFocused();
      await expect(failed).toContainText('The invite is unchanged. Reload the page and try again.');
      await expect(main(page)).not.toContainText('Check your connection');
      await expect(pendingRows(page)).toHaveCount(1);
      await expect(revokeButton(page, email)).toBeVisible();
      await screenshot(page, testInfo, '228-staff-revoke-server-error');
      await expectAccessible(page);
    });

    test('a refusal with a reason shows it', async ({ page }, testInfo) => {
      const email = 'erin@example.com';
      await openStaffWithInvite(page, email, {
        beforeOpen: async () => {
          await interceptMutation(page, 'invites:revoke', 'refused');
        },
      });
      await revokeButton(page, email).click();
      const refused = page
        .getByRole('alert')
        .filter({ hasText: `Invite to ${email} could not be revoked.` });
      await expect(refused).toBeFocused();
      await expect(refused).toContainText(
        'This invite is no longer pending, so there is nothing to revoke. It was accepted or revoked already.',
      );
      await screenshot(page, testInfo, '228-staff-revoke-refused');
      await expectAccessible(page);
    });
  });

  test.describe('a refusal from the server', () => {
    test.use({ expectedConvexErrors: ['invites:restore'] });

    test(
      'a newer pending invite to the same address refuses Undo, says why, and leaves the first invite revoked',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const email = 'dana@example.com';
        const { token } = await openStaffWithInvite(page, email);
        await revokeButton(page, email).click();
        await expect(undoButton(page, email)).toBeVisible();

        // The address is invited again while the first status is still up.
        await page.locator('#email').fill(email);
        await page.getByRole('radio', { name: 'Org admin' }).check();
        await page.getByRole('button', { name: /^Create invite link/ }).click();
        await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeVisible();

        await undoButton(page, email).click();
        const refused = page.getByRole('alert').filter({
          hasText: `Invite to ${email} could not be restored.`,
        });
        await expect(refused).toContainText(
          `${email} already has a newer pending invite, so the old link stays revoked.`,
        );
        await expect(undoButton(page, email)).toHaveCount(0);
        await expect(pendingRows(page)).toHaveCount(1);

        const link = await inviteLinkHeading(page, token);
        await expect(link.heading).toHaveText('This invite link can’t be used');
        await link.tab.close();
      },
    );
  });

  test('Undo goes when the 10 minutes pass: the status stays, and takes focus when Undo had it', async ({
    page,
  }, testInfo) => {
    const email = 'dana@example.com';
    await openStaffWithInvite(page, email, {
      beforeOpen: async () => {
        await page.clock.install();
      },
    });
    await revokeButton(page, email).click();
    const revoked = page.getByRole('status').filter({ hasText: `Invite to ${email} revoked.` });
    await expect(revoked).toBeFocused();
    await page.keyboard.press(tabKey(page));
    await expect(undoButton(page, email)).toBeFocused();

    await page.clock.fastForward('09:50');
    await expect(undoButton(page, email)).toBeVisible();
    await page.clock.fastForward('00:15');
    await expect(undoButton(page, email)).toHaveCount(0);
    await expect(revoked).toBeFocused();
    await expect(revoked).toContainText(
      'Its link no longer works. You can invite this address again.',
    );
    await screenshot(page, testInfo, '228-staff-undo-window-passed');
    await expectAccessible(page);
  });

  test('every Revoke shows it is waiting while an Undo is in flight', async ({
    page,
  }, testInfo) => {
    const email = 'dana@example.com';
    const other = 'erin@example.com';
    let undo: { release: () => void } | undefined;
    await openStaffWithInvite(page, email, {
      otherEmails: [other],
      beforeOpen: async () => {
        undo = await interceptMutation(page, 'invites:restore', 'hold');
      },
    });
    await revokeButton(page, email).click();
    await undoButton(page, email).click();
    const working = page.getByRole('button', { name: 'Undoing…' });
    await expect(working).toHaveAttribute('aria-disabled', 'true');
    await expect(revokeButton(page, other)).toHaveAttribute('aria-disabled', 'true');
    await expect(revokeButton(page, other)).toHaveClass(/opacity-50/);
    // Playwright waits for an aria-disabled button to be enabled, and a real press is what is under test.
    await revokeButton(page, other).click({ force: true });
    await expect(pendingRows(page)).toHaveCount(1);
    await screenshot(page, testInfo, '228-staff-revoke-waits-for-undo');
    await expectAccessible(page);
    // The accessibility check moves focus, and a reply takes focus from the pressed button but not from where the walk left it.
    await working.focus();

    undo?.release();
    await expect(
      page.getByRole('status').filter({ hasText: `Invite to ${email} restored.` }),
    ).toBeFocused();
    await expect(revokeButton(page, other)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a reply to Undo leaves focus where the user moved while it was in flight', async ({
    page,
  }) => {
    const email = 'dana@example.com';
    let undo: { release: () => void } | undefined;
    await openStaffWithInvite(page, email, {
      beforeOpen: async () => {
        undo = await interceptMutation(page, 'invites:restore', 'hold');
      },
    });
    await revokeButton(page, email).click();
    await undoButton(page, email).click();
    await expect(page.getByRole('button', { name: 'Undoing…' })).toBeVisible();
    await page.locator('#email').focus();

    undo?.release();
    await expect(
      page.getByRole('status').filter({ hasText: `Invite to ${email} restored.` }),
    ).toBeVisible();
    await expect(page.locator('#email')).toBeFocused();
  });

  test('a revoke in flight reads "Revoking…" on its own button and waits on the others', async ({
    page,
  }, testInfo) => {
    const email = 'dana@example.com';
    const other = 'erin@example.com';
    let revoke: { release: () => void } | undefined;
    await openStaffWithInvite(page, email, {
      otherEmails: [other],
      beforeOpen: async () => {
        revoke = await interceptMutation(page, 'invites:revoke', 'hold');
      },
    });
    await revokeButton(page, email).click();
    await expect(page.getByRole('button', { name: 'Revoking…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(revokeButton(page, other)).toHaveAttribute('aria-disabled', 'true');
    await screenshot(page, testInfo, '228-staff-revoking');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Revoking…' }).focus();

    revoke?.release();
    await expect(
      page.getByRole('status').filter({ hasText: `Invite to ${email} revoked.` }),
    ).toBeFocused();
    await expect(revokeButton(page, other)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test.describe('an invite that is no longer revoked', () => {
    test.use({ expectedConvexErrors: ['invites:restore'] });

    test('refuses Undo with the server’s reason and drops Undo', async ({ page }, testInfo) => {
      const email = 'dana@example.com';
      const { tenant } = await openStaffWithInvite(page, email);
      const elsewhere = await page.context().newPage();
      const token = await appToken(elsewhere);
      const context = await call(elsewhere, token, 'query', 'organizations:getAdminContext', {
        slug: tenant.slug,
      });
      const { organizationId } = context.value as { organizationId: string };
      const listed = await call(elsewhere, token, 'query', 'invites:listPending', {
        organizationId,
      });
      const { inviteId } = (listed.value as { inviteId: string; email: string }[]).find(
        (row) => row.email === email,
      )!;

      await revokeButton(page, email).click();
      await expect(undoButton(page, email)).toBeVisible();
      const restored = await call(elsewhere, token, 'mutation', 'invites:restore', { inviteId });
      expect(restored.status).toBe('success');
      await elsewhere.close();
      await expect(pendingRows(page)).toHaveCount(1);

      await undoButton(page, email).click();
      const refused = page
        .getByRole('alert')
        .filter({ hasText: `Invite to ${email} could not be restored.` });
      await expect(refused).toBeFocused();
      await expect(refused).toContainText(
        'This invite is no longer revoked, so there is nothing to undo. It was restored or accepted already.',
      );
      await expect(undoButton(page, email)).toHaveCount(0);
      await screenshot(page, testInfo, '228-staff-restore-not-revoked');
      await expectAccessible(page);
    });
  });
});

// The calls go straight to the backend's HTTP API with the signed-in admin's token, all started
// together; only the invariant is asserted, not which call wins.
interface Outcome {
  status: string;
  errorData?: unknown;
}

/** The Convex token the app itself fetches on a signed-in load (the session is not a cookie). */
async function appToken(page: Page): Promise<string> {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === TOKEN_PATH);
  await page.goto('/app');
  const body = (await (await response).json()) as { token: string };
  return body.token;
}

async function call(
  page: Page,
  token: string,
  kind: 'query' | 'mutation' | 'action',
  path: string,
  args: unknown,
): Promise<Outcome & { value?: unknown }> {
  return page.evaluate(
    async ({ token, url, kind, path, args }) => {
      const response = await fetch(`${url}/api/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ path, args, format: 'json' }),
      });
      return (await response.json()) as Outcome & { value?: unknown };
    },
    { token, url: LOCAL_CONVEX_URL, kind, path, args },
  );
}

test.describe('Staff: Undo racing another write on the real backend', () => {
  test(
    'restore racing create, and restore racing restore, leave one pending invite per address',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      test.slow(); // sign-up plus many sequential calls: a loaded runner needs the longer timeout
      const admin = newUser('Admin');
      await signUp(page, admin);
      const tenant = await seedTenant({ name: 'E2E Undo Race' });
      await convexRun('testing:addMembership', {
        organizationSlug: tenant.slug,
        email: admin.email,
        role: 'orgAdmin',
      });
      const token = await appToken(page);
      const context = await call(page, token, 'query', 'organizations:getAdminContext', {
        slug: tenant.slug,
      });
      expect(context.status, JSON.stringify(context)).toBe('success');
      const organizationId = (context.value as { organizationId: string }).organizationId;

      const seedRevoked = async (email: string) => {
        await convexRun('testing:addInvite', {
          organizationSlug: tenant.slug,
          email,
          role: 'orgAdmin',
          expiresAt: Date.now() + 14 * DAY,
          token: randomBytes(32).toString('base64url'),
        });
        const list = await call(page, token, 'query', 'invites:listPending', { organizationId });
        const rows = list.value as { inviteId: string; email: string }[];
        const row = rows.find((candidate) => candidate.email === email)!;
        expect(
          (await call(page, token, 'mutation', 'invites:revoke', { inviteId: row.inviteId }))
            .status,
        ).toBe('success');
        return row.inviteId;
      };
      const pendingFor = async (email: string) => {
        const list = await call(page, token, 'query', 'invites:listPending', { organizationId });
        return (list.value as { email: string }[]).filter((row) => row.email === email).length;
      };

      for (let round = 0; round < RACE_ROUNDS; round++) {
        const email = `race-create-${round}@example.com`;
        const inviteId = await seedRevoked(email);
        const [restored, created] = await Promise.all([
          call(page, token, 'mutation', 'invites:restore', { inviteId }),
          call(page, token, 'action', 'invites:create', {
            organizationId,
            email,
            role: 'orgAdmin',
            leagueIds: [],
          }),
        ]);
        expect([restored.status, created.status].filter((s) => s === 'success')).toHaveLength(1);
        expect(await pendingFor(email)).toBe(1);
      }

      for (let round = 0; round < RACE_ROUNDS; round++) {
        const email = `race-restore-${round}@example.com`;
        const first = await seedRevoked(email);
        const second = await seedRevoked(email);
        const [a, b] = await Promise.all([
          call(page, token, 'mutation', 'invites:restore', { inviteId: first }),
          call(page, token, 'mutation', 'invites:restore', { inviteId: second }),
        ]);
        expect([a.status, b.status].filter((s) => s === 'success')).toHaveLength(1);
        expect(await pendingFor(email)).toBe(1);
      }
    },
  );
});
