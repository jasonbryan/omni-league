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
  'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some web addresses, like new, are reserved.';

const CITY_STATE_MESSAGE = 'Use 2 to 60 characters, such as Corpus Christi, TX.';

const tabOrderBeforeMain = (): string[] =>
  test.info().project.use.isMobile
    ? ['button[aria-label="Open navigation"]', 'header a[href="/app/account"]']
    : [
        'a[href="/"]',
        'nav[aria-label="Your account"] a[href="/app"]',
        'nav[aria-label="Your account"] a[href="/leagues"]',
        'a[href="/app/account"]',
      ];

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
// The home sidebar's group, which a phone keeps in its closed menu.
const organizations = (page: Page) =>
  page.getByRole('list', { name: 'Your organizations', includeHidden: true });
const organizationLinks = (page: Page) =>
  organizations(page).getByRole('link', { includeHidden: true });

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
  test('/app with no organization offers to run a league; its button opens the form', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('None'));
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2, name: 'Run a league?' })).toBeVisible();
    await expect(main).toContainText(
      'Create an organization to publish your leagues and take registrations.',
    );
    await expect(organizations(page)).toHaveCount(0);
    await screenshot(page, testInfo, '64-app-none');
    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        ...tabOrderBeforeMain(),
        'main a[href="/leagues"]',
        'main a[href="/app/organizations/new"]',
        'main a[href="/app/notifications"]',
      ],
    });
    await main.getByRole('link', { name: 'Create an organization' }).click();
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

  test('the empty form: labels, the address under Web address, axe, and Tab order', async ({
    page,
    hasTouch,
  }, testInfo) => {
    await signUp(page, newUser('Form'));
    await openForm(page);
    await expect(page.getByLabel('Name')).toHaveAttribute('autocomplete', 'organization');
    await expect(page.getByLabel('Web address')).toHaveAttribute('autocomplete', 'off');
    const host = new URL(baseURL).host;
    await expect(page.locator('#slug-description')).toContainText(
      `Your public page will be at ${host}/organizations/your-address`,
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
    'Web address follows the name until it is edited; the address follows the field',
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
    await expect(fieldError(page, 'slug')).toHaveText('Enter a web address for your public page.');
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

  test.describe('web address availability while typing', () => {
    const availability = (page: Page) => page.locator('#slug-availability');

    test('a free address says Available in a polite status, before any submit', async ({
      page,
    }, testInfo) => {
      const free = newOrganization('Free');
      await signUp(page, newUser('Avail'));
      await openForm(page);
      await expect(availability(page)).toHaveAttribute('role', 'status');
      await field(page, 'slug').fill(free.slug);
      await expect(availability(page)).toHaveText('Available');
      await expect(fieldError(page, 'slug')).toHaveCount(0);
      await screenshot(page, testInfo, '208-new-available');
      await expectAccessible(page, { expectedOrder: formOrder() });
    });

    test('a typed address that is taken says so before any submit', async ({ page }, testInfo) => {
      test.skip(!!remoteBaseUrl, NO_SEED);
      const taken = await seedTenant({ name: 'E2E Typed' });
      await signUp(page, newUser('Typed'));
      await openForm(page);
      await field(page, 'slug').fill(taken.slug);
      await expect(fieldError(page, 'slug')).toHaveText(
        `${taken.slug} is already taken. Choose another web address.`,
      );
      await expect(fieldError(page, 'slug').locator('strong')).toHaveText(taken.slug);
      await expect(field(page, 'slug')).toHaveAttribute('aria-invalid', 'true');
      await expect(availability(page)).toHaveText('');
      await screenshot(page, testInfo, '208-new-taken-typed');
      await expectAccessible(page, { expectedOrder: formOrder() });
    });

    test('a name whose derived address is taken says so before any submit', async ({ page }) => {
      test.skip(!!remoteBaseUrl, NO_SEED);
      const taken = await seedTenant({ name: 'E2E Derived' });
      await signUp(page, newUser('Derived'));
      await openForm(page);
      // The seeded address is `e2e-<id>`, which is what this name turns into.
      await field(page, 'name').fill(`E2E ${taken.slug.slice('e2e-'.length)}`);
      await expect(field(page, 'slug')).toHaveValue(taken.slug);
      await expect(fieldError(page, 'slug')).toHaveText(
        `${taken.slug} is already taken. Choose another web address.`,
      );
    });

    test('an address that fails the format rule shows its message only after the field is left', async ({
      page,
    }) => {
      await signUp(page, newUser('Format'));
      await openForm(page);
      await field(page, 'slug').pressSequentially('Bad-Address');
      await page.waitForTimeout(600);
      await expect(fieldError(page, 'slug')).toHaveCount(0);
      await expect(availability(page)).toHaveText('');
      await field(page, 'name').focus();
      await expect(fieldError(page, 'slug')).toHaveText(FORMAT_MESSAGE);
    });
  });

  test.describe('a web address that is taken', () => {
    test.use({ expectedConvexErrors: ['organizations:create'] });

    test('shows the approved message on Web address, keeps the values, and creates nothing', async ({
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
        `${taken.slug} is already taken. Choose another web address.`,
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
    await expect(organizationLinks(page)).toHaveText([org.name]);
    await expect(organizationLinks(page)).toHaveAttribute('href', `/app/organizations/${org.slug}`);
    const main = page.getByRole('main');
    await expect(main).not.toContainText(org.name);
    await expect(main).not.toContainText('Run a league?');
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
        await expect(organizationLinks(page)).toHaveText([a.name]);
        await second.goto('/app');
        await expect(organizationLinks(second)).toHaveText([b.name]);
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
    await expect(organizationLinks(page)).toHaveText([
      `Alpha Club ${id}`,
      `Mike Club ${id}`,
      `Zulu Club ${id}`,
    ]);
    await screenshot(page, testInfo, '64-app-several');
    await expectAccessible(page);
  });
});
