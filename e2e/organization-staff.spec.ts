import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible, tabKey } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { expect, test } from './support/fixtures';
import { holdMutations } from './support/hold-mutations';
import { expectSpinnerAtButtonStart } from './support/pending-spinner';
import { screenshot } from './support/screenshot';
import { seedAccountsInCalls } from './support/seed-accounts';
import { signUp } from './support/session';
import { seedTenant, type TenantSeed } from './support/tenant';
import { newUser, seedUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
];
const LEAGUES: NonNullable<TenantSeed['leagues']> = [
  { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Redfish Flats Fields'] },
  {
    name: 'Wednesday Coed Slow-Pitch',
    sport: 'softball',
    locations: ['Redfish Flats Fields'],
    status: 'draft',
  },
];
const DAY = 24 * 60 * 60 * 1000;

type Role = 'orgAdmin' | 'leagueOrganizer';

async function memberOf(page: Page, role: Role | null, seed: TenantSeed = {}) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Staff', ...seed });
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  }
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

async function openStaff(
  page: Page,
  seed: TenantSeed = { locations: LOCATIONS, leagues: LEAGUES },
) {
  const org = await memberOf(page, 'orgAdmin', seed);
  await page.goto(`${org.base}/staff`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  return org;
}

const main = (page: Page) => page.getByRole('main');
const form = (page: Page) => page.locator('#invite form');
const createButton = (page: Page) =>
  form(page).getByRole('button', { name: /^Create invite link/ });
const pendingRows = (page: Page) => page.locator('#pending-list > li');
const memberRows = (page: Page) => page.locator('#members-list > li');
const linkField = (page: Page) => page.locator('#invite-link');
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function holdLeaguesAnswer(page: Page) {
  const org = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
  // Convex applies transitions in order, so holding the answer to the leagues query holds every
  // frame after it; the form is not rendered while the leagues load.
  let leaguesQuery: number | undefined;
  let holding = false;
  const held: string[] = [];
  let release: () => void = () => undefined;
  interface Change {
    type: string;
    queryId: number;
    udfPath?: string;
  }
  const changes = (message: string | Buffer): Change[] =>
    (JSON.parse(String(message)) as { modifications?: Change[] }).modifications ?? [];
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      for (const change of changes(message)) {
        if (change.type === 'Add' && change.udfPath === 'leagues:listForAdmin') {
          leaguesQuery = change.queryId;
        }
      }
      server.send(message);
    });
    release = () => {
      holding = false;
      for (const frame of held.splice(0)) ws.send(frame);
    };
    server.onMessage((message) => {
      const answersLeagues = changes(message).some(
        (change) => change.type === 'QueryUpdated' && change.queryId === leaguesQuery,
      );
      if (answersLeagues) holding = true;
      if (holding) held.push(String(message));
      else ws.send(message);
    });
  });
  await page.goto(`${org.base}/staff`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await expect(page.getByText('Loading the leagues.')).toBeAttached();
  await expect.poll(() => holding).toBe(true);
  return { release: () => release() };
}

async function invite(page: Page, email: string, leagues: string[] = []) {
  await page.locator('#email').fill(email);
  if (leagues.length === 0) await page.getByRole('radio', { name: 'Org admin' }).check();
  for (const league of leagues) await page.getByRole('checkbox', { name: league }).click();
  await createButton(page).click();
}

test.describe('Staff: inviting', () => {
  test('a league organizer invite shows the link once; the list shows it pending with no link; a reload shows no link', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await openStaff(page);
    await expect(page).toHaveTitle(`Staff | ${tenant.name} | Omni League`);
    await expect(memberRows(page)).toHaveCount(1);
    await expect(memberRows(page).first()).toContainText('(you)');
    await expect(memberRows(page).first()).toContainText('Org admin');
    await expect(page.getByText('No pending invites')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'League organizer' })).toBeChecked();
    await screenshot(page, testInfo, '67-staff-empty');
    await expectAccessible(page);

    await page.locator('#email').fill('  Dana.Whitlock@Example.com ');
    await page.getByRole('checkbox', { name: 'Wednesday Coed Slow-Pitch' }).click();
    await screenshot(page, testInfo, '67-staff-filled');
    await createButton(page).click();

    const heading = page.getByRole('heading', { name: 'Invite link ready' });
    await expect(heading).toBeFocused();
    await expect(page.locator('#invite')).toContainText(
      'Send this link to dana.whitlock@example.com yourself, by email or text. It works until ',
    );
    await expect(page.locator('#invite')).toContainText('This is the only time the link is shown.');
    await expect(form(page)).toHaveCount(0);
    const link = await linkField(page).inputValue();
    const origin = new URL(page.url()).origin;
    expect(link).toMatch(new RegExp(`^${origin}/invites/accept#[A-Za-z0-9_-]{43}$`));
    await screenshot(page, testInfo, '67-staff-link');
    await expectAccessible(page);

    await expect(pendingRows(page)).toHaveCount(1);
    await expect(pendingRows(page).first().locator('h3')).toHaveText('dana.whitlock@example.com');
    await expect(pendingRows(page).first()).toContainText(
      'League organizer for Wednesday Coed Slow-Pitch',
    );
    await expect(pendingRows(page).first()).toContainText('Expires ');
    await expect(memberRows(page)).toHaveCount(1);
    await expect(pendingRows(page).first().locator('textarea, a')).toHaveCount(0);
    const token = link.split('#')[1];
    expect(await pendingRows(page).first().innerHTML()).not.toContain(token);

    await page.reload();
    await expect(pendingRows(page)).toHaveCount(1);
    await expect(linkField(page)).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
    expect(page.url()).not.toContain(token);
    await screenshot(page, testInfo, '67-staff-reloaded');
    await expectAccessible(page);
    void base;
  });

  test('Tabbing to the link field from the Revoke button above it scrolls the whole field into view', async ({
    page,
  }) => {
    await openStaff(page);
    await invite(page, 'dana@example.com');
    const revoke = pendingRows(page)
      .first()
      .getByRole('button', { name: /^Revoke/ });
    await revoke.focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(revoke).toBeInViewport();
    await page.keyboard.press(tabKey(page));
    await expect(linkField(page)).toBeFocused();
    // Read at once: WebKit's own scroll to a focused text field comes later on macOS and shows only the caret line on Linux.
    const shownWhole = await linkField(page).evaluate((field) => {
      const { top, bottom } = field.getBoundingClientRect();
      // The page scrolls by whole pixels and the field sits at a fraction of one.
      return Math.round(top) >= 0 && Math.round(bottom) <= innerHeight;
    });
    expect(shownWhole).toBe(true);
  });

  test(
    'Role defaults to League organizer; Org admin removes the Leagues group and League organizer brings it back with the choices kept',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await openStaff(page);
      const organizer = page.getByRole('radio', { name: 'League organizer' });
      const admin = page.getByRole('radio', { name: 'Org admin' });
      const leagues = page.getByRole('group', { name: 'Leagues' });
      await expect(organizer).toBeChecked();
      await expect(leagues).toBeVisible();
      await page.getByRole('checkbox', { name: 'Coed 7v7 Rec' }).click();
      await admin.check();
      await expect(leagues).toHaveCount(0);
      await organizer.check();
      await expect(leagues).toBeVisible();
      await expect(page.getByRole('checkbox', { name: 'Coed 7v7 Rec' })).toBeChecked();
      await expect(
        page.getByRole('checkbox', { name: 'Wednesday Coed Slow-Pitch' }),
      ).not.toBeChecked();
    },
  );

  test('Role is one radiogroup named by its legend; Tab enters it at the chosen option, arrow keys move and choose, and Tab leaves it', async ({
    page,
  }) => {
    await openStaff(page);
    const group = page.getByRole('radiogroup', { name: 'Role' });
    const organizer = group.getByRole('radio', { name: 'League organizer' });
    const admin = group.getByRole('radio', { name: 'Org admin' });
    await expect(group.getByRole('radio')).toHaveCount(2);
    await page.locator('#email').focus();
    await page.keyboard.press(tabKey(page));
    await expect(organizer).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(admin).toBeFocused();
    await expect(admin).toBeChecked();
    await expect(page.getByRole('group', { name: 'Leagues' })).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await expect(organizer).toBeFocused();
    await expect(organizer).toBeChecked();
    await page.keyboard.press(tabKey(page));
    await expect(page.getByRole('checkbox', { name: 'Coed 7v7 Rec' })).toBeFocused();
    await page.keyboard.press(`Shift+${tabKey(page)}`);
    await expect(organizer).toBeFocused();
  });

  test('an org admin invite lists as Org admin and carries no leagues', async ({ page }) => {
    await openStaff(page);
    await invite(page, 'boss@example.com');
    await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
    await expect(pendingRows(page).first()).toContainText('Org admin');
    await expect(pendingRows(page).first()).not.toContainText('League organizer');
  });

  test('"Invite someone else" returns the empty form with focus on Email', async ({ page }) => {
    await openStaff(page);
    await invite(page, 'one@example.com');
    await page.getByRole('button', { name: 'Invite someone else' }).click();
    await expect(page.locator('#email')).toBeFocused();
    await expect(page.locator('#email')).toHaveValue('');
    await expect(linkField(page)).toHaveCount(0);
    await invite(page, 'two@example.com');
    await expect(pendingRows(page)).toHaveCount(2);
  });

  test('refuses an empty form with every message, and creates nothing', async ({
    page,
  }, testInfo) => {
    await openStaff(page);
    await createButton(page).click();
    await expect(page.locator('#email-error')).toHaveText('Enter their email address.');
    await expect(page.locator('#leagues-error')).toHaveText('Choose at least one league.');
    await expect(page.locator('#email')).toBeFocused();
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await screenshot(page, testInfo, '67-staff-errors');
    await expectAccessible(page);

    await page.locator('#email').fill('not-an-email');
    await createButton(page).click();
    await expect(page.locator('#email-error')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await page.locator('#email').fill('fine@example.com');
    await createButton(page).click();
    await expect(page.locator('#email-error')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Coed 7v7 Rec' })).toBeFocused();
    await expect(page.getByText('No pending invites')).toBeVisible();
  });

  test.describe('refusals from the server', () => {
    test.use({ expectedConvexErrors: ['invites:create'] });

    test('an address that is already a member, and one that is already invited, is refused with the approved message', async ({
      page,
    }, testInfo) => {
      const { user } = await openStaff(page);
      await invite(page, user.email.toUpperCase());
      await expect(page.locator('#email-error')).toHaveText(
        `${user.email} is already on your staff.`,
      );
      await expect(page.locator('#email')).toBeFocused();
      await screenshot(page, testInfo, '67-staff-already-member');
      await expectAccessible(page);

      await page.locator('#email').fill('dana@example.com');
      await createButton(page).click();
      await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
      await page.getByRole('button', { name: 'Invite someone else' }).click();

      await invite(page, 'Dana@Example.com');
      await expect(page.locator('#email-error')).toHaveText(
        'dana@example.com already has a pending invite. To send a new link, revoke that invite first.',
      );
      await expect(pendingRows(page)).toHaveCount(1);
      await screenshot(page, testInfo, '67-staff-already-invited');
      await expectAccessible(page);
    });
  });
});

test.describe('Staff: no leagues', () => {
  test('League organizer is unavailable with the message under Role, and Org admin can still be invited', async ({
    page,
  }, testInfo) => {
    await openStaff(page, { locations: LOCATIONS });
    const organizer = page.getByRole('radio', { name: 'League organizer' });
    await expect(organizer).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Org admin' })).toBeChecked();
    await expect(page.locator('#role')).toContainText(
      'Create a league first to invite a league organizer.',
    );
    await expect(page.getByRole('group', { name: 'Leagues' })).toHaveCount(0);
    await screenshot(page, testInfo, '67-staff-no-leagues');
    await expectAccessible(page);
    await page.locator('#email').fill('boss@example.com');
    await createButton(page).click();
    await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
  });
});

test.describe('Staff: no leagues, by keyboard', () => {
  test('arrow keys skip the unavailable League organizer, and Tab lands on Org admin and then leaves the group', async ({
    page,
  }) => {
    await openStaff(page, { locations: LOCATIONS });
    const group = page.getByRole('radiogroup', { name: 'Role' });
    const organizer = group.getByRole('radio', { name: 'League organizer' });
    const admin = group.getByRole('radio', { name: 'Org admin' });
    await expect(organizer).toHaveAccessibleDescription(
      'Runs only the leagues you choose. Create a league first to invite a league organizer.',
    );
    await page.locator('#email').focus();
    await page.keyboard.press(tabKey(page));
    await expect(admin).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(admin).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(admin).toBeFocused();
    await expect(admin).toBeChecked();
    await expect(organizer).not.toBeChecked();
    await page.keyboard.press(tabKey(page));
    await expect(createButton(page)).toBeFocused();
  });
});

test.describe('Staff: copying the link', () => {
  test('"Copy link" puts the whole link on the clipboard, then says "Copied"', async ({
    page,
    context,
    browserName,
  }, testInfo) => {
    // WebKit has no `clipboard-write` permission: it lets a click write, and refuses the grant.
    await context.grantPermissions(
      browserName === 'webkit' ? ['clipboard-read'] : ['clipboard-read', 'clipboard-write'],
    );
    await openStaff(page);
    await invite(page, 'dana@example.com');
    const link = await linkField(page).inputValue();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(page.locator('#copy-status')).toHaveText('Link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await screenshot(page, testInfo, '67-staff-copied');
    await expectAccessible(page);
  });

  for (const [label, script] of [
    [
      'the permission is denied',
      () => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
          },
        });
      },
    ],
    [
      'navigator.clipboard is missing',
      () => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      },
    ],
  ] as const) {
    test(`when ${label}, the status says so, the button keeps its text, and the link stays visible`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(script);
      await openStaff(page);
      await invite(page, 'dana@example.com');
      const link = await linkField(page).inputValue();
      await page.getByRole('button', { name: 'Copy link' }).click();
      await expect(page.locator('#copy-status')).toHaveText(
        'Couldn’t copy. Select the link and copy it.',
      );
      await expect(page.locator('#copy-status')).toHaveAttribute('role', 'status');
      await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
      await expect(linkField(page)).toHaveValue(link);
      await expect(linkField(page)).toBeVisible();
      await screenshot(page, testInfo, `67-staff-copy-blocked-${label.replace(/\W+/g, '-')}`);
      await expectAccessible(page);
    });
  }
});

test.describe('Staff: revoking', () => {
  test('Revoke while the request is held: the spinner sits at the button start', async ({
    page,
  }) => {
    const org = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
    const held = await holdMutations(page);
    await convexRun('testing:addInvite', {
      organizationSlug: org.tenant.slug,
      email: 'dana@example.com',
      role: 'orgAdmin',
      expiresAt: Date.now() + 14 * DAY,
    });
    await page.goto(`${org.base}/staff`);
    await expect(pendingRows(page)).toHaveCount(1);
    held.hold();
    await page.getByRole('button', { name: 'Revoke the invite to dana@example.com' }).click();

    const busy = pendingRows(page)
      .first()
      .getByRole('button', { name: /^Revoking…/ });
    await expect(busy).toHaveAttribute('aria-disabled', 'true');
    await expectSpinnerAtButtonStart(busy);

    held.release();
    await expect(pendingRows(page)).toHaveCount(0);
  });

  test('acts at once with no confirmation; the status is above the list with focus; the address can be invited again', async ({
    page,
  }, testInfo) => {
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    const { tenant } = await openStaff(page);
    for (const email of ['dana@example.com', 'erin@example.com']) {
      await convexRun('testing:addInvite', {
        organizationSlug: tenant.slug,
        email,
        role: 'orgAdmin',
        expiresAt: Date.now() + 14 * DAY,
      });
    }
    await expect(pendingRows(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Revoke the invite to dana@example.com' }).click();
    const status = page
      .getByRole('status')
      .filter({ hasText: 'Invite to dana@example.com revoked.' });
    await expect(status).toContainText(
      'Its link no longer works. You can invite this address again.',
    );
    await expect(status).toBeFocused();
    await expect(pendingRows(page)).toHaveCount(1);
    await expect(pendingRows(page).first().locator('h3')).toHaveText('erin@example.com');
    expect(dialogs).toBe(0);
    await screenshot(page, testInfo, '67-staff-revoked');
    await expectAccessible(page);

    await invite(page, 'dana@example.com');
    await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
    await expect(pendingRows(page)).toHaveCount(2);
  });

  test('an invite whose expiry has passed is listed as Expired with the hint and Revoke; it blocks the address until revoked', async ({
    page,
  }, testInfo) => {
    const { tenant } = await openStaff(page);
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: 'r.castillo@example.com',
      role: 'leagueOrganizer',
      leagueNames: ['Coed 7v7 Rec'],
      expiresAt: Date.now() - 9 * DAY,
    });
    const row = pendingRows(page).first();
    await expect(row).toContainText(/Expired [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(row).toContainText('Revoke it to invite this address again.');
    await expect(row).not.toContainText('Expires ');
    await screenshot(page, testInfo, '67-staff-expired');
    await expectAccessible(page);
  });

  test('an invite that expires while the page is open turns to Expired without a reload', async ({
    page,
  }, testInfo) => {
    const { tenant } = await openStaff(page);
    const LIFETIME_MS = 6_000;
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: 'r.castillo@example.com',
      role: 'leagueOrganizer',
      leagueNames: ['Coed 7v7 Rec'],
      expiresAt: Date.now() + LIFETIME_MS,
    });
    const row = pendingRows(page).first();
    await expect(row).toContainText('Expires ');
    await expect(row).toContainText(/Expired [A-Z][a-z]{2} \d{1,2}, \d{4}/, { timeout: 15_000 });
    await expect(row).not.toContainText('Expires ');
    await expect(row).toContainText('Revoke it to invite this address again.');
    await screenshot(page, testInfo, '175-staff-expired-while-open');
    await expectAccessible(page);
  });

  test.describe('an expired address', () => {
    test.use({ expectedConvexErrors: ['invites:create'] });

    test('is refused as already invited until it is revoked, and then succeeds', async ({
      page,
    }) => {
      const { tenant } = await openStaff(page);
      await convexRun('testing:addInvite', {
        organizationSlug: tenant.slug,
        email: 'r.castillo@example.com',
        role: 'orgAdmin',
        expiresAt: Date.now() - 9 * DAY,
      });
      await expect(pendingRows(page)).toHaveCount(1);
      await invite(page, 'r.castillo@example.com');
      await expect(page.locator('#email-error')).toContainText(
        'r.castillo@example.com already has a pending invite.',
      );
      await page
        .getByRole('button', { name: 'Revoke the invite to r.castillo@example.com' })
        .click();
      await expect(pendingRows(page)).toHaveCount(0);
      await createButton(page).click();
      await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
    });
  });
});

test.describe('Staff: members and the Overview', () => {
  test('lists every member with role and leagues, and the Overview counts 3 staff and 2 pending invites', async ({
    page,
  }, testInfo) => {
    // Drafts only, so the Overview still lists "Get set up" (it hides once a league is published).
    const org = await memberOf(page, 'orgAdmin', {
      locations: LOCATIONS,
      leagues: LEAGUES.map((league) => ({ ...league, status: 'draft' as const })),
    });
    const second = await seedUser(newUser('Second'));
    const third = await seedUser(newUser('Third'));
    await convexRun('testing:addMembership', {
      organizationSlug: org.tenant.slug,
      email: second.email,
      role: 'orgAdmin',
    });
    await convexRun('testing:addMembership', {
      organizationSlug: org.tenant.slug,
      email: third.email,
      role: 'leagueOrganizer',
    });
    for (const email of ['p1@example.com', 'p2@example.com']) {
      await convexRun('testing:addInvite', {
        organizationSlug: org.tenant.slug,
        email,
        role: 'orgAdmin',
        expiresAt: Date.now() + 14 * DAY,
      });
    }

    await page.goto(org.base);
    await expect(main(page).getByRole('link', { name: '3 staff' })).toBeVisible();
    await expect(
      main(page).getByRole('region', { name: 'Needs your attention' }).getByRole('listitem'),
    ).toContainText('2 staff invites are pending');
    await screenshot(page, testInfo, '67-overview-staff-count');
    await expectAccessible(page);
    const step = page.getByRole('region', { name: 'Get set up' });
    await step.getByRole('link', { name: 'Invite staff' }).click();
    await expect(page).toHaveURL(`${baseURL}${org.base}/staff`);

    await expect(memberRows(page)).toHaveCount(3);
    await expect(memberRows(page).filter({ hasText: second.email })).toContainText('Org admin');
    await expect(memberRows(page).filter({ hasText: third.email })).toContainText(
      'League organizer',
    );
    await expect(memberRows(page).filter({ hasText: '(you)' })).toContainText(org.user.email);
    await expect(pendingRows(page)).toHaveCount(2);
    await screenshot(page, testInfo, '67-staff-populated');
    await expectAccessible(page);
  });

  test('the sidebar lists Staff and marks it current', async ({ page }) => {
    const { tenant } = await openStaff(page);
    if (isDesktop(page)) {
      const nav = page.getByRole('navigation', { name: `${tenant.name} admin` });
      await expect(nav.getByRole('link')).toHaveText([
        /Switch organization/,
        'Overview',
        /^Leagues\d*$/,
        /^Locations\d*$/,
        /^Staff\d*$/,
        'Details',
        'View public page',
      ]);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(/^Staff\d*$/);
    }
  });

  test('"Invite staff" in the header jumps to the form and focuses Email (360)', async ({
    page,
  }) => {
    await openStaff(page);
    const jump = main(page).getByRole('link', { name: 'Invite staff' });
    if (isDesktop(page)) {
      await expect(jump).toBeHidden();
      return;
    }
    await jump.click();
    await expect(page.locator('#email')).toBeFocused();
    await expect(page.locator('#email')).toBeInViewport();
  });

  const jumpLink = (page: Page) => main(page).getByRole('link', { name: 'Invite staff' });
  const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

  test('"Invite staff" pressed while the leagues load focuses Email once the form appears (360)', async ({
    page,
  }) => {
    test.skip(isDesktop(page), 'the link is hidden from 1024px');
    const leagues = await holdLeaguesAnswer(page);
    await jumpLink(page).click();
    await expect(form(page)).toHaveCount(0);
    leagues.release();
    await expect(page.locator('#email')).toBeFocused();
    await expect(page.locator('#email')).toBeInViewport();
  });

  test('"Invite staff" pressed while the leagues load focuses the section at once (360)', async ({
    page,
  }) => {
    test.skip(isDesktop(page), 'the link is hidden from 1024px');
    await holdLeaguesAnswer(page);
    await jumpLink(page).click();
    await expect(page.locator('#invite')).toBeFocused();
    await expect(form(page)).toHaveCount(0);
  });

  test('"Invite staff" then a click on the page text while the leagues load leaves Email unfocused and the page where it is', async ({
    page,
  }) => {
    test.skip(isDesktop(page), 'the link is hidden from 1024px');
    const leagues = await holdLeaguesAnswer(page);
    await jumpLink(page).click();
    await main(page).getByText('Org admins manage everything here').click();
    const before = await scrollY(page);
    leagues.release();
    await expect(form(page)).toBeAttached();
    await expect(page.locator('#email')).not.toBeFocused();
    await expect(main(page)).toBeFocused();
    expect(await scrollY(page)).toBe(before);
  });

  test('"Invite staff" then a click on the panel heading while the leagues load keeps the jump (360)', async ({
    page,
  }) => {
    test.skip(isDesktop(page), 'the link is hidden from 1024px');
    const leagues = await holdLeaguesAnswer(page);
    await jumpLink(page).click();
    await page.locator('#invite-heading').click();
    leagues.release();
    await expect(page.locator('#email')).toBeFocused();
  });

  test('"Invite staff" then a scroll while the leagues load leaves Email unfocused and the page where it is', async ({
    page,
    browserName,
  }) => {
    test.skip(isDesktop(page), 'the link is hidden from 1024px');
    test.skip(browserName === 'webkit', 'Playwright mobile WebKit has no mouse wheel');
    const leagues = await holdLeaguesAnswer(page);
    // The page is short while the form is missing, so a spacer gives the wheel room to scroll.
    // Scroll anchoring would otherwise follow the spacer down when the form arrives above it.
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      spacer.style.overflowAnchor = 'none';
      document.querySelector('main')!.append(spacer);
    });
    await jumpLink(page).click();
    await expect(page.locator('#invite')).toBeFocused();
    const jumped = await scrollY(page);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(jumped);
    const before = await scrollY(page);
    leagues.release();
    await expect(form(page)).toBeAttached();
    await expect(page.locator('#email')).not.toBeFocused();
    expect(await scrollY(page)).toBe(before);
  });

  test('"Invite staff" then a tap on the header title while the leagues load leaves Email unfocused and the page where it is', async ({
    page,
  }) => {
    test.skip(isDesktop(page), 'the link is hidden from 1024px');
    const leagues = await holdLeaguesAnswer(page);
    await jumpLink(page).click();
    await expect(page.locator('#invite')).toBeFocused();
    await page.locator('header p.truncate').tap();
    const focusedAfterTap = await page.evaluateHandle(() => document.activeElement);
    const before = await scrollY(page);
    leagues.release();
    await expect(form(page)).toBeAttached();
    await expect(page.locator('#email')).not.toBeFocused();
    expect(
      await page.evaluate((element) => document.activeElement === element, focusedAfterTap),
    ).toBe(true);
    expect(await scrollY(page)).toBe(before);
  });

  test.describe('with the first answer failing', () => {
    test('"Invite staff" focuses the alert, and the form that replaces it gives focus to the section', async ({
      page,
    }) => {
      test.skip(isDesktop(page), 'the link is hidden from 1024px');
      const org = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
      const failure = await failFirstAnswer(page, 'leagues:listForAdmin');
      await page.goto(`${org.base}/staff`);
      const alert = page.getByRole('alert').filter({ hasText: 'The leagues could not be loaded.' });
      await expect(alert).toBeVisible();
      await jumpLink(page).click();
      await expect(alert).toBeFocused();

      await failure.reconnect();
      await expect(form(page)).toBeAttached();
      await expect(page.locator('#invite')).toBeFocused();
      await expect(page.locator('#email')).not.toBeFocused();
    });
  });
});

test.describe('Staff: past 200 rows', () => {
  const CAPPED_ORG = 'E2E Staff capped';
  const prefix = () => `capped-${randomBytes(4).toString('hex')}`;
  const staffPath = (slug: string) => `/app/organizations/${slug}/staff`;
  const sectionNote = (page: Page, text: string) => main(page).getByText(text, { exact: true });

  test('201 pending invites list 200 and say so; revoking the first drops the note and Undo brings it back', async ({
    page,
  }, testInfo) => {
    test.slow(); // a 201-invite seed and an axe Tab walk over about 210 tab stops
    const emailPrefix = prefix();
    const { tenant } = await memberOf(page, 'orgAdmin', { name: CAPPED_ORG });
    await convexRun('testing:seedPendingInvites', {
      organizationSlug: tenant.slug,
      count: 201,
      emailPrefix,
    });
    const first = `${emailPrefix}-001@example.test`;
    const note = sectionNote(page, 'Showing the first 200 of 201 pending invites.');
    await page.goto(staffPath(tenant.slug));
    await expect(pendingRows(page)).toHaveCount(200);
    await expect(pendingRows(page).first().locator('h3')).toHaveText(first);
    await expect(note).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '568-staff-invites-capped');

    await page.getByRole('button', { name: `Revoke the invite to ${first}` }).click();
    await expect(page.getByText(`Invite to ${first} revoked.`)).toBeVisible();
    await expect(pendingRows(page)).toHaveCount(200);
    await expect(note).toHaveCount(0);

    await page.getByRole('button', { name: `Undo revoking the invite to ${first}` }).click();
    await expect(page.getByText(`Invite to ${first} restored.`)).toBeVisible();
    await expect(pendingRows(page)).toHaveCount(200);
    await expect(pendingRows(page).first().locator('h3')).toHaveText(first);
    await expect(note).toBeVisible();
  });

  test('202 members list the 200 added first and say so', async ({ page }, testInfo) => {
    test.slow(); // a 201-account seed and an axe Tab walk over about 210 tab stops
    const emailPrefix = prefix();
    const { tenant } = await memberOf(page, 'orgAdmin', { name: CAPPED_ORG });
    await seedAccountsInCalls('testing:seedStaff', 201, {
      organizationSlug: tenant.slug,
      emailPrefix,
    });
    await page.goto(staffPath(tenant.slug));
    await expect(memberRows(page)).toHaveCount(200);
    await expect(memberRows(page).filter({ hasText: '(you)' })).toHaveCount(1);
    await expect(memberRows(page).locator('h3', { hasText: 'Staff 199' })).toHaveCount(1);
    await expect(memberRows(page).locator('h3', { hasText: /^\s*Staff 20[01]\s*$/ })).toHaveCount(
      0,
    );
    await expect(sectionNote(page, 'Showing the 200 added first, of 202 members.')).toBeVisible();
    await expectAccessible(page);
    if (!isDesktop(page)) await screenshot(page, testInfo, '568-staff-members-capped');
  });
});

test.describe('Staff: who may open it', () => {
  function sentFrames(page: Page): string[] {
    const frames: string[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => {
        frames.push(String(frame.payload));
      });
    });
    return frames;
  }

  for (const [label, role] of [
    ['a league organizer of the organization', 'leagueOrganizer'],
    ['a signed-in user with no membership', null],
  ] as const) {
    test(
      `${label} sees the no-access view, and no staff data is requested`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const user = newUser('Outsider');
        await signUp(page, user);
        const tenant = await seedTenant({
          name: 'E2E Closed',
          locations: LOCATIONS,
          leagues: LEAGUES,
        });
        await convexRun('testing:addInvite', {
          organizationSlug: tenant.slug,
          email: 'secret.invitee@example.com',
          role: 'orgAdmin',
          expiresAt: Date.now() + 14 * DAY,
        });
        if (role) {
          await convexRun('testing:addMembership', {
            organizationSlug: tenant.slug,
            email: user.email,
            role,
          });
        }
        const frames = sentFrames(page);
        await page.goto(`/app/organizations/${tenant.slug}/staff`);
        await expect(
          main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
        ).toBeVisible();
        await expect(page.locator('body')).not.toContainText('secret.invitee@example.com');
        const sent = frames.join('\n');
        expect(sent).toContain('organizations:getAdminContext');
        expect(sent).not.toContain('invites:listPending');
        expect(sent).not.toContain('memberships:listForOrganization');
        expect(sent).not.toContain('memberships:staffCount');
      },
    );
  }

  test('the no-access view is saved as a screenshot and passes the axe helper', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Outsider'));
    const tenant = await seedTenant({ name: 'E2E Closed', locations: LOCATIONS, leagues: LEAGUES });
    await page.goto(`/app/organizations/${tenant.slug}/staff`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await screenshot(page, testInfo, '67-staff-no-access');
    await expectAccessible(page);
  });

  test(
    'an org admin of another organization is refused',
    VIEWPORT_AGNOSTIC,
    async ({ page, browser }) => {
      const owner = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
      await convexRun('testing:addInvite', {
        organizationSlug: owner.tenant.slug,
        email: 'hidden.invitee@example.com',
        role: 'orgAdmin',
        expiresAt: Date.now() + 14 * DAY,
      });
      const intruder = await browser.newPage({ baseURL });
      try {
        await memberOf(intruder, 'orgAdmin');
        await intruder.goto(`${owner.base}/staff`);
        await expect(
          intruder.getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
        ).toBeVisible();
        await expect(intruder.locator('body')).not.toContainText('hidden.invitee@example.com');
      } finally {
        await intruder.context().close();
      }
    },
  );

  test(
    'an unknown slug shows the not-found view and requests no staff data',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await signUp(page, newUser('Lost'));
      const frames = sentFrames(page);
      await page.goto(`/app/organizations/does-not-exist-${randomBytes(3).toString('hex')}/staff`);
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
      ).toBeVisible();
      expect(frames.join('\n')).not.toContain('invites:listPending');
    },
  );
});
