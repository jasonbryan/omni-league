import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { otherUser, signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { screenshot } from './support/screenshot';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import { randomBytes } from 'node:crypto';

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';

const FORMAT_MESSAGE =
  'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.';

const CITY_STATE_MESSAGE = 'Use 2 to 60 characters, such as Corpus Christi, TX.';

const tabOrderBeforeMain = (): string[] =>
  test.info().project.use.isMobile
    ? ['button[aria-label="Open navigation"]', 'header a[href="/app/account"]']
    : ['a[href="/"]', 'nav[aria-label="Your account"] a[href="/app"]', 'a[href="/app/account"]'];

const formOrder = (): string[] => [
  'a[href$="#main"]',
  ...tabOrderBeforeMain(),
  'main a[href="/app"]',
  '#name',
  '#cityState',
  '#slug',
  'button[type="submit"]',
];

const field = (page: Page, id: string) => page.locator(`#${id}`);
const fieldError = (page: Page, id: string) => page.locator(`#${id}-error`);
const createButton = (page: Page) => page.getByRole('button', { name: /Create organization/ });
const organizations = (page: Page) => page.getByRole('region', { name: 'Your organizations' });

function newOrganization(label = 'Org') {
  const id = randomBytes(4).toString('hex');
  return { name: `E2E ${label} ${id}`, slug: `e2e-${label.toLowerCase()}-${id}` };
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
      'Ask your league organizer for an invite or registration link to join a league, or create an organization to run your own.',
    );
    await screenshot(page, testInfo, '64-app-none');
    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        ...tabOrderBeforeMain(),
        'main a[href="/app/organizations/new"]',
        'main a[href="/leagues"]',
      ],
    });
    await organizations(page).getByRole('link', { name: 'Create an organization' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
    await expect(page).toHaveTitle('Create an organization | Omni League');
  });

  test(
    'a signed-out visitor opening the form goes to sign-in with returnTo',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await page.goto('/app/organizations/new');
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/app/organizations/new');
    },
  );

  test('the empty form: labels, the address under Slug, axe, and Tab order', async ({
    page,
    hasTouch,
  }, testInfo) => {
    await signUp(page, newUser('Form'));
    await openForm(page);
    await expect(page.getByLabel('Name')).toHaveAttribute('autocomplete', 'organization');
    await expect(page.getByLabel('Slug')).toHaveAttribute('autocomplete', 'off');
    const host = new URL(baseURL).host;
    await expect(page.locator('#slug-description')).toContainText(
      `Your public page will be at ${host}/organizations/your-slug`,
    );
    // 16px input text on phones so iOS does not zoom.
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    for (const control of [
      field(page, 'name'),
      field(page, 'cityState'),
      field(page, 'slug'),
      createButton(page),
    ]) {
      expect((await control.boundingBox())?.height).toBe(hasTouch ? 44 : 36);
    }
    for (const id of ['name', 'cityState', 'slug']) {
      await expect(field(page, id)).toHaveCSS('font-size', phone ? '16px' : '14px');
    }
    await screenshot(page, testInfo, '64-new-empty');
    await expectAccessible(page, { expectedOrder: formOrder() });
  });

  test(
    'Slug follows the name until it is edited; the address follows the slug',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
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
    },
  );

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
    await expectAccessible(page, { expectedOrder: formOrder() });
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
  });

  test('a slug is checked when the user leaves it, and the error clears as they fix it', async ({
    page,
  }) => {
    await signUp(page, newUser('Leave'));
    await openForm(page);

    await field(page, 'name').focus();
    await page.keyboard.press('Tab');
    await expect(field(page, 'cityState')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(field(page, 'slug')).toBeFocused();
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await expect(fieldError(page, 'cityState')).toHaveCount(0);
    await page.keyboard.type('Bad-Slug');
    await expect(fieldError(page, 'slug')).toHaveCount(0);

    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'slug')).toHaveText(FORMAT_MESSAGE);
    await expect(field(page, 'slug')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'slug')).toHaveAttribute(
      'aria-describedby',
      'slug-description slug-error',
    );
    await expectAccessible(page, { expectedOrder: formOrder() });

    await field(page, 'slug').fill('fixed-slug');
    await expect(fieldError(page, 'slug')).toHaveCount(0);
    await expect(field(page, 'slug')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
  });

  test('City, state is optional, checked when the user leaves it, and stored when valid', async ({
    page,
  }) => {
    const org = newOrganization('City');
    await signUp(page, newUser('City'));
    await openForm(page);
    await expect(page.locator('#cityState-description')).toHaveText('Such as Corpus Christi, TX');
    await field(page, 'name').fill(org.name);
    await field(page, 'slug').fill(org.slug);

    await field(page, 'cityState').fill('X');
    await expect(fieldError(page, 'cityState')).toHaveCount(0);
    await field(page, 'cityState').blur();
    await expect(fieldError(page, 'cityState')).toHaveText(CITY_STATE_MESSAGE);
    await expect(field(page, 'cityState')).toHaveAttribute('aria-invalid', 'true');
    await field(page, 'cityState').fill('c'.repeat(61));
    await field(page, 'cityState').blur();
    await expect(fieldError(page, 'cityState')).toHaveText(CITY_STATE_MESSAGE);
    await createButton(page).click();
    await expect(field(page, 'cityState')).toBeFocused();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);

    await field(page, 'cityState').fill('  Corpus   Christi, TX ');
    await expect(fieldError(page, 'cityState')).toHaveCount(0);
    await createButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/${org.slug}`);
    await page.goto(`/app/organizations/${org.slug}/details`);
    await expect(field(page, 'cityState')).toHaveValue('Corpus Christi, TX');
  });

  test('leaving City, state blank stores none', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const org = newOrganization('Blank');
    await signUp(page, newUser('Blank'));
    await openForm(page);
    await field(page, 'name').fill(org.name);
    await field(page, 'slug').fill(org.slug);
    await createButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/${org.slug}`);
    await page.goto(`/app/organizations/${org.slug}/details`);
    await expect(field(page, 'cityState')).toHaveValue('');
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
    await expectAccessible(page, { expectedOrder: formOrder() });
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
      await expectAccessible(page, { expectedOrder: formOrder() });

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

    await expect(page).toHaveURL(`${baseURL}/app/organizations/${org.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Get set up' })).toBeVisible();

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
    await expect(row.getByRole('link', { name: `Manage ${org.name}` })).toHaveAttribute(
      'href',
      `/app/organizations/${org.slug}`,
    );
    await expect(panel.getByRole('link', { name: 'Create an organization' })).toBeVisible();
    await screenshot(page, testInfo, '64-app-one');
    await expectAccessible(page);
  });

  test(
    "each user's list holds only their own organization",
    VIEWPORT_AGNOSTIC,
    async ({ page, browser }) => {
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
    },
  );

  test('several organizations are listed by name', async ({ page }, testInfo) => {
    const id = randomBytes(3).toString('hex');
    const names = [`Zulu Club ${id}`, `Alpha Club ${id}`, `Mike Club ${id}`];
    await signUp(page, newUser('Several'));
    for (const name of names) {
      await openForm(page);
      await field(page, 'name').fill(name);
      await createButton(page).click();
      // Fills the slug from the name so the landing page is known; the form's own path also
      // contains "/organizations/".
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
