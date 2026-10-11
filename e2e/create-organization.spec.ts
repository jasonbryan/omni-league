// Create an organization (#64): `/app/organizations/new` and "Your organizations" on `/app`, both
// Client routes behind sign-up (approved design design/mockups/64-create-organization.html). Every
// test signs up its own user through the real form, so each runs against a preview too; the ones
// that seed a tenant (a taken slug) need the local Convex backend and are skipped with
// E2E_BASE_URL set.
import type { Page, TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { otherUser, signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { randomBytes } from 'node:crypto';

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';

/** The format message for every malformed, too short or long, and reserved slug. */
const FORMAT_MESSAGE =
  'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.';

/** Form order (mockup "Focus order"), with the top bar's account link (#63). */
const FORM_ORDER = [
  'a[href$="#main"]',
  'header a[href="/"]',
  'header a[href="/app"]',
  'main a[href="/app"]',
  '#name',
  '#slug',
  'button[type="submit"]',
];

const field = (page: Page, id: string) => page.locator(`#${id}`);
const fieldError = (page: Page, id: string) => page.locator(`#${id}-error`);
const createButton = (page: Page) => page.getByRole('button', { name: /Create organization/ });
const organizations = (page: Page) => page.getByRole('region', { name: 'Your organizations' });

/** A name and slug no other test or run uses. */
function newOrganization(label = 'Org') {
  const id = randomBytes(4).toString('hex');
  return { name: `E2E ${label} ${id}`, slug: `e2e-${label.toLowerCase()}-${id}` };
}

/** A full-page PNG for the tester's mockup comparison, at this project's width. */
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()?.width ?? 0;
  const file = join(testInfo.config.rootDir, 'screenshots', `${name}-${width}.png`);
  const png = await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await testInfo.attach(`${name}-${width}.png`, { body: png, contentType: 'image/png' });
}

async function openForm(page: Page): Promise<void> {
  await page.goto('/app/organizations/new');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create an organization' }),
  ).toBeVisible();
}

test.describe('create an organization', () => {
  test('/app with no organization shows the none state; its button opens the form', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('None'));
    await expect(organizations(page).getByText('No organizations yet')).toBeVisible();
    await expect(organizations(page)).toContainText(
      'Create one to run your leagues on Omni League, or ask an org admin to invite you to theirs.',
    );
    await screenshot(page, testInfo, '64-app-none');
    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        'header a[href="/app"]',
        'main button',
        'main a[href="/app/organizations/new"]',
      ],
    });
    await organizations(page).getByRole('link', { name: 'Create an organization' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
    await expect(page).toHaveTitle('Create an organization | Omni League');
  });

  test('a signed-out visitor opening the form goes to sign-in with returnTo', async ({ page }) => {
    await page.goto('/app/organizations/new');
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/app/organizations/new');
  });

  test('the empty form: labels, the address under Slug, axe, and Tab order', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Form'));
    await openForm(page);
    await expect(page.getByLabel('Name')).toHaveAttribute('autocomplete', 'organization');
    await expect(page.getByLabel('Slug')).toHaveAttribute('autocomplete', 'off');
    const host = new URL(baseURL).host;
    await expect(page.locator('#slug-description')).toContainText(
      `Your public page will be at ${host}/organizations/your-slug`,
    );
    // 36px controls, and 16px input text on phones so iOS does not zoom.
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    for (const control of [field(page, 'name'), field(page, 'slug'), createButton(page)]) {
      expect((await control.boundingBox())?.height).toBe(36);
    }
    for (const id of ['name', 'slug']) {
      await expect(field(page, id)).toHaveCSS('font-size', phone ? '16px' : '14px');
    }
    await screenshot(page, testInfo, '64-new-empty');
    await expectAccessible(page, { expectedOrder: FORM_ORDER });
  });

  test('Slug follows the name until it is edited; the address follows the slug', async ({
    page,
  }) => {
    await signUp(page, newUser('Follow'));
    await openForm(page);
    const host = new URL(baseURL).host;
    await field(page, 'name').fill('Coastal Bend Rec Club');
    await expect(field(page, 'slug')).toHaveValue('coastal-bend-rec-club');
    await expect(page.locator('#slug-description')).toContainText(
      `${host}/organizations/coastal-bend-rec-club`,
    );
    await field(page, 'slug').fill('my-own-slug');
    await expect(page.locator('#slug-description')).toContainText(
      `${host}/organizations/my-own-slug`,
    );
    await field(page, 'name').fill('A Different Name');
    await expect(field(page, 'slug')).toHaveValue('my-own-slug');
  });

  test('submitted empty, the field errors show and nothing is created', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Empty'));
    await openForm(page);
    await createButton(page).click();
    await expect(fieldError(page, 'name')).toHaveText('Enter your organization’s name.');
    await expect(fieldError(page, 'slug')).toHaveText(
      'Enter a slug for your public page’s address.',
    );
    for (const id of ['name', 'slug']) {
      await expect(field(page, id)).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, id)).toHaveAttribute(
        'aria-describedby',
        `${id}-description ${id}-error`,
      );
    }
    await expect(field(page, 'name')).toBeFocused();
    await screenshot(page, testInfo, '64-new-errors-required');
    await expectAccessible(page, { expectedOrder: FORM_ORDER });
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
  });

  test('a whitespace-only and a 101-character name are refused with the field error', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Name'));
    await openForm(page);
    await field(page, 'name').fill('     ');
    await field(page, 'slug').fill('valid-slug');
    await createButton(page).click();
    await expect(fieldError(page, 'name')).toHaveText('Enter your organization’s name.');
    await expect(field(page, 'name')).toBeFocused();

    // The error stays while the name is invalid, and says what is wrong now.
    await field(page, 'name').fill('n'.repeat(101));
    await expect(fieldError(page, 'name')).toHaveText(
      'Use 100 characters or fewer. This name has 101.',
    );
    await createButton(page).click();
    await expect(fieldError(page, 'name')).toHaveText(
      'Use 100 characters or fewer. This name has 101.',
    );
    await expect(field(page, 'name')).toBeFocused();
    await screenshot(page, testInfo, '64-new-errors-format');
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
    await expect(organizations(page)).toHaveCount(0);
  });

  test('malformed, short, long, and reserved slugs are refused with the format message', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Slug'));
    await openForm(page);
    await field(page, 'name').fill('Valid Name');
    const refused = [
      'ab',
      'Bad-Slug',
      'a--b',
      '-ab',
      'new',
      'a'.repeat(61),
      'gulf-coast-sport-social',
    ];
    for (const slug of refused) {
      await field(page, 'slug').fill(slug);
      await createButton(page).click();
      await expect(fieldError(page, 'slug'), slug).toHaveText(FORMAT_MESSAGE);
      await expect(field(page, 'slug')).toBeFocused();
      await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
    }
    await field(page, 'slug').fill('new');
    await createButton(page).click();
    await screenshot(page, testInfo, '64-new-reserved');
    await expectAccessible(page, { expectedOrder: FORM_ORDER });
  });

  test.describe('a slug that is taken', () => {
    test.use({ expectedConvexErrors: ['organizations:create'] });

    test('shows the approved message on Slug, keeps the values, and creates nothing', async ({
      page,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, NO_SEED);
      const taken = await seedTenant({ name: 'E2E Taken' });
      await signUp(page, newUser('Taken'));
      await openForm(page);
      await field(page, 'name').fill('Another Organization');
      await field(page, 'slug').fill(taken.slug);
      await createButton(page).click();
      await expect(fieldError(page, 'slug')).toHaveText(
        `${taken.slug} is already taken. Choose another slug.`,
      );
      await expect(fieldError(page, 'slug').locator('strong')).toHaveText(taken.slug);
      await expect(field(page, 'slug')).toBeFocused();
      await expect(field(page, 'slug')).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, 'slug')).toHaveValue(taken.slug);
      await expect(field(page, 'name')).toHaveValue('Another Organization');
      await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
      await screenshot(page, testInfo, '64-new-taken');
      await expectAccessible(page, { expectedOrder: FORM_ORDER });

      // Editing the slug clears the message; the organization then goes through.
      const free = newOrganization('Free');
      await field(page, 'slug').fill(free.slug);
      await expect(fieldError(page, 'slug')).toHaveCount(0);
      await createButton(page).click();
      await expect(page).toHaveURL(`${baseURL}/app/organizations/${free.slug}`);
    });
  });

  test('creates the organization, lands on its admin Overview, and lists it on /app', async ({
    page,
  }, testInfo) => {
    const org = newOrganization('Create');
    await signUp(page, newUser('Creator'));
    await openForm(page);
    await field(page, 'name').fill(org.name);
    await field(page, 'slug').fill(org.slug);
    await createButton(page).click();

    // The admin Overview with its "Get set up" list (#65 decision 5), not the public page.
    await expect(page).toHaveURL(`${baseURL}/app/organizations/${org.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Get set up' })).toBeVisible();

    // The public page, with #60's empty states.
    await page.goto(`/organizations/${org.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: org.name })).toBeVisible();
    await expect(page.getByText('No leagues yet').first()).toBeVisible();

    await page.goto('/app');
    const panel = organizations(page);
    const row = panel.getByRole('listitem').filter({ hasText: org.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Org admin');
    // The accessible name is "Public page: <name>" (a screen-reader-only span names the
    // organization); the browser lays the span out as a block, so a space can precede the colon.
    await expect(
      row.getByRole('link', { name: new RegExp(`^Public page ?: ${org.name}$`) }),
    ).toHaveAttribute('href', `/organizations/${org.slug}`);
    // "Manage" (#65) leads to the admin area, and its name includes the organization.
    await expect(row.getByRole('link', { name: `Manage ${org.name}` })).toHaveAttribute(
      'href',
      `/app/organizations/${org.slug}`,
    );
    await expect(panel.getByRole('link', { name: 'Create an organization' })).toBeVisible();
    await screenshot(page, testInfo, '64-app-one');
    await expectAccessible(page);
  });

  test("each user's list holds only their own organization", async ({ page, browser }) => {
    const a = newOrganization('A');
    const b = newOrganization('B');
    await signUp(page, newUser('UserA'));
    await openForm(page);
    await field(page, 'name').fill(a.name);
    await field(page, 'slug').fill(a.slug);
    await createButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/${a.slug}`);

    const second = await otherUser(browser, newUser('UserB'));
    try {
      await openForm(second);
      await field(second, 'name').fill(b.name);
      await field(second, 'slug').fill(b.slug);
      await createButton(second).click();
      await expect(second).toHaveURL(`${baseURL}/app/organizations/${b.slug}`);

      await page.goto('/app');
      await expect(organizations(page).getByRole('listitem')).toHaveCount(1);
      await expect(organizations(page)).toContainText(a.name);
      await expect(organizations(page)).not.toContainText(b.name);
      await second.goto('/app');
      await expect(organizations(second).getByRole('listitem')).toHaveCount(1);
      await expect(organizations(second)).toContainText(b.name);
      await expect(organizations(second)).not.toContainText(a.name);
    } finally {
      await second.context().close();
    }
  });

  test('several organizations are listed by name', async ({ page }, testInfo) => {
    const id = randomBytes(3).toString('hex');
    const names = [`Zulu Club ${id}`, `Alpha Club ${id}`, `Mike Club ${id}`];
    await signUp(page, newUser('Several'));
    for (const name of names) {
      await openForm(page);
      await field(page, 'name').fill(name);
      await createButton(page).click();
      // The slug filled from the name, so the landing page is known (the form's own path also
      // contains "/organizations/").
      await expect(page).toHaveURL(
        `${baseURL}/app/organizations/${name.toLowerCase().replaceAll(' ', '-')}`,
      );
    }
    await page.goto('/app');
    await expect(organizations(page).getByRole('listitem')).toHaveCount(3);
    await expect(organizations(page).getByRole('heading', { level: 3 })).toHaveText([
      `Alpha Club ${id}`,
      `Mike Club ${id}`,
      `Zulu Club ${id}`,
    ]);
    await screenshot(page, testInfo, '64-app-several');
    await expectAccessible(page);
  });
});
