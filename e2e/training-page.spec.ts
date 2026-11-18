import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { axeScan, checkReflow, describeViolations, expectAccessible } from './support/a11y';
import { answerWithClientShell } from './support/client-shell';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import {
  cancelSeededTrainingClasses,
  seedPublishedTraining,
  seedTraining,
  seedTrainingClasses,
  setTrainingClassRegistered,
  type PublishedTrainingSeed,
} from './support/training';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');
const textOf = (html: string | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const PLACE = 'North Beach Sand Courts';
const ADDRESS = '3500 Sandcourt Ln, Corpus Christi, TX 78402';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const FIRST_IN_DAYS = 7;
const FIRST_DATE = dateFromToday(FIRST_IN_DAYS);
const WEEKDAY = weekdayOf(FIRST_DATE);
const PATTERN_TEXT = `${WEEKDAYS[WEEKDAY]}s, 6 to 7 pm, 3 weeks`;

const classes = (firstInDays: number, weeks = 3) => ({
  weekday: weekdayOf(dateFromToday(firstInDays)),
  startTime: '18:00',
  endTime: '19:00',
  firstDate: dateFromToday(firstInDays),
  weeks,
  placesPerClass: 12,
  registrationDeadline: dateFromToday(firstInDays - 2),
});

function clinic(overrides: Partial<PublishedTrainingSeed> = {}): PublishedTrainingSeed {
  const token = randomBytes(3).toString('hex');
  return {
    name: `Serving Clinic ${token}`,
    slug: `serving-clinic-${token}`,
    locations: [PLACE],
    coachName: 'Dana Ruiz',
    minimumAge: 16,
    classes: classes(FIRST_IN_DAYS),
    ...overrides,
  };
}

async function seedTenantWithPlace(name: string): Promise<Tenant> {
  return seedTenant({ name, locations: [{ name: PLACE, address: ADDRESS }] });
}

async function seed(overrides: Partial<PublishedTrainingSeed> = {}) {
  const tenant = await seedTenantWithPlace('E2E Training Page');
  const program = clinic(overrides);
  const published = await seedPublishedTraining(tenant, program);
  await setTrainingClassRegistered(tenant, program.slug, dateFromToday(FIRST_IN_DAYS + 7), 5);
  await setTrainingClassRegistered(tenant, program.slug, dateFromToday(FIRST_IN_DAYS + 14), 12);
  const draft = await seedPublishedTraining(
    tenant,
    clinic({ name: 'Secret Draft Clinic', slug: 'secret-draft-clinic', status: 'draft' }),
  );
  return { tenant, program, published, draft };
}

test.describe('public training page: raw server HTML', () => {
  test(
    'a published program: 200, the public Cache-Control, the coach, the pattern, and each upcoming class with its places left before the details, the title, and the link-preview tags',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, program, published } = await seed();
      for (const query of ['', '?ott=SECRETtoken&page=2']) {
        const { status, headers, html } = await fetchRawHtml(request, `${published}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');
        expect(headers['netlify-vary'], query).toBe('query');
        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]), query).toBe(program.name);
        expect(textOf(html), query).toContain('Dana Ruiz');
        expect(textOf(html), query).toContain(PATTERN_TEXT);
        expect(textOf(html), query).toContain('16 or older');
        expect(html, query).toContain(ADDRESS);

        const markup = html.slice(html.indexOf('<body'));
        const order = [
          '<h1',
          PATTERN_TEXT,
          'id="classes"',
          '12 places left',
          'id="details-heading"',
          'Dana Ruiz',
          ADDRESS,
        ].map((marker) => markup.indexOf(marker));
        expect(
          order.every((position) => position > 0),
          query,
        ).toBe(true);
        expect(order, query).toEqual([...order].sort((a, b) => a - b));

        const rows = [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)]
          .map(([row]) => textOf(row))
          .filter((row) => /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat),/.test(row));
        expect(rows, query).toHaveLength(3);
        expect(rows[0], query).toContain('12 places left');
        expect(rows[1], query).toContain('7 places left');
        expect(rows[2], query).toContain('Full');
        expect(textOf(html), query).not.toMatch(/This training has ended/);

        expect(html, query).toContain(
          `<title>${program.name} | ${tenant.name} | Omni League</title>`,
        );
        expect(html, query).toContain(
          `<meta property="og:title" content="${program.name} | ${tenant.name} | Omni League"`,
        );
        expect(html, query).toMatch(/<meta property="og:description" content="Beach volleyball/);
        expect(html, query).toContain('property="og:type" content="website"');
        expect(html, query).toMatch(/<meta property="og:url" content="[^"]+\/training\//);
        expect(html, query).toContain('<link rel="canonical" href="');
        expect(html, query).toContain(`${published}"`);
        expect(html, query).toContain(`href="${tenant.path}"`);
        expect(html, query).not.toContain('SECRETtoken');
        expect(html, query).not.toContain('ott=');
      }
    },
  );

  test(
    'a program whose classes have all passed says "This training has ended." with no class and no registration',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await seedTenantWithPlace('E2E Training Ended');
      const program = clinic({ classes: classes(-30, 2) });
      const published = await seedPublishedTraining(tenant, program);
      const { status, html } = await fetchRawHtml(request, published);
      expect(status).toBe(200);
      expect(textOf(html)).toContain('This training has ended.');
      expect(textOf(html)).not.toMatch(/Registration|places left/);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    },
  );

  test(
    'a series in progress says In progress and no longer writes when registration closes',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await seedTenantWithPlace('E2E Training In Progress');
      const published = await seedPublishedTraining(tenant, clinic({ classes: classes(-7) }));
      const { status, html } = await fetchRawHtml(request, published);
      expect(status).toBe(200);
      expect(textOf(html)).toContain('In progress');
      expect(textOf(html)).not.toMatch(/Closes|Registration open/);
    },
  );

  test(
    'a program whose every class is cancelled says so in place of the ended line, with no class and no registration, and is on no list',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await seedTenantWithPlace('E2E Training Cancelled');
      const program = clinic();
      const published = await seedPublishedTraining(tenant, program);
      await cancelSeededTrainingClasses(tenant, program.slug);
      const { status, html } = await fetchRawHtml(request, published);
      expect(status).toBe(200);
      expect(textOf(html)).toContain('Every class of this training program is cancelled.');
      expect(textOf(html)).not.toMatch(/This training has ended|Registration|places left/);
      const organization = await fetchRawHtml(request, tenant.path);
      expect(textOf(organization.html)).not.toContain(program.name);
    },
  );

  test(
    'a draft program, an unknown web address, and an unknown organization answer 404 with the not-found view and nothing about the draft',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, program, draft } = await seed();
      for (const path of [
        draft,
        `${tenant.path}/training/no-such-training`,
        `/organizations/no-such-org-${tenant.slug}/training/${program.slug}`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Secret Draft Clinic');
      }
    },
  );
});

test.describe('public training page: in the browser', () => {
  test('a published program lists its upcoming classes with their places, passes the axe helper, and does not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { tenant, program, published } = await seed();
    const response = await page.goto(published);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: program.name })).toBeVisible();
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page).toHaveTitle(`${program.name} | ${tenant.name} | Omni League`);
    await expect(page.getByText(PATTERN_TEXT).first()).toBeVisible();
    await expect(page.getByText('Dana Ruiz')).toBeVisible();
    await expect(page.getByText(ADDRESS)).toBeVisible();

    const rows = page.locator('#classes li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('12 places left');
    await expect(rows.nth(1)).toContainText('7 places left');
    await expect(rows.nth(2).locator('[data-slot="class-places"]')).toHaveText('Full');
    await expect(page.locator('[data-slot="series-status"]')).toHaveText('Registration open');
    await expect(page.getByRole('link', { name: /Register/ })).toHaveCount(0);

    await screenshot(page, testInfo, 'training-public');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });

  test('an ended program passes the axe helper and does not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await seedTenantWithPlace('E2E Training Ended Page');
    const program = clinic({ classes: classes(-30, 2) });
    const published = await seedPublishedTraining(tenant, program);
    await page.goto(published);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.getByText('This training has ended.')).toBeVisible();
    await expect(page.locator('#classes li')).toHaveCount(0);
    await expect(page.locator('[data-slot="series-status"]')).toHaveCount(0);
    await screenshot(page, testInfo, 'training-public-ended');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });

  test('a program whose every class is cancelled passes the axe helper and does not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await seedTenantWithPlace('E2E Training Cancelled Page');
    const program = clinic();
    const published = await seedPublishedTraining(tenant, program);
    await cancelSeededTrainingClasses(tenant, program.slug);
    await page.goto(published);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(
      page.getByText('Every class of this training program is cancelled.'),
    ).toBeVisible();
    await expect(page.getByText('This training has ended.')).toHaveCount(0);
    await expect(page.locator('#classes li')).toHaveCount(0);
    await expect(page.locator('[data-slot="series-status"]')).toHaveCount(0);
    await screenshot(page, testInfo, 'training-public-cancelled');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });

  test('a long name, coach, and place wrap at 320px without scrolling sideways', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const longWord = 'Supercalifragilisticexpialidocious'.repeat(3);
    const tenant = await seedTenant({
      name: 'E2E Training Long',
      locations: [
        { name: `${longWord} Courts`, address: `${longWord} Street, Corpus Christi, TX` },
      ],
    });
    const program = clinic({
      name: `${longWord} Serving Clinic`,
      slug: `long-${randomBytes(3).toString('hex')}`,
      coachName: `${longWord} Coach`,
      locations: [`${longWord} Courts`],
    });
    const published = await seedPublishedTraining(tenant, program);
    await page.goto(published);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(longWord);
    await screenshot(page, testInfo, 'training-public-long');
    expect(await checkReflow(page)).toMatchObject({ passed: true });
    await expectAccessible(page);
  });

  test('the breadcrumb leads to the organization page, and its Training crumb opens the Training section', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, program, published } = await seed();
    await page.goto(published);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await crumbs.getByRole('link', { name: 'E2E Training Page' }).click();
    await expect(page).toHaveURL(tenant.path);

    await page.goBack();
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const trainingCrumb = crumbs.getByRole('link', { name: 'Training', exact: true });
    const trainingHref = await trainingCrumb.getAttribute('href');
    await trainingCrumb.click();
    await expect(page).toHaveURL(`${tenant.path}#training`);
    const section = page.locator('#training');
    await expect(section.getByRole('link', { name: program.name, exact: true })).toBeVisible();

    // Opened as a link, in a new tab or from a shared URL, the browser scrolls to the section.
    await page.goto(trainingHref!);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(section.getByRole('heading', { level: 2, name: 'Training' })).toBeInViewport();
  });

  test('the loaded page starts where its skeleton did when its lines do not wrap, with no jump when the answer arrives', async ({
    page,
  }) => {
    const tenant = await seedTenant({
      name: 'E2E Training Shift',
      locations: [{ name: 'Courts', address: '1 Sand Rd, Corpus Christi, TX 78402' }],
    });
    const program = clinic({ name: 'Serve Clinic', slug: 'serve-clinic', locations: ['Courts'] });
    const published = await seedPublishedTraining(tenant, program);
    const held = await holdQueries(page, ['trainings:getPublicPage']);
    await answerWithClientShell(page, published);
    await page.goto(published);
    await expect.poll(() => held.isHolding()).toBe(true);
    const skeleton = page.getByTestId('training-skeleton');
    await expect(skeleton).toBeVisible();
    const skeletonCard = (await skeleton.locator('[data-slot="card"]').boundingBox())!;
    const skeletonHeading = (await skeleton.getByTestId('skeleton-heading').boundingBox())!;

    held.release();
    await expect(page.getByRole('heading', { level: 1, name: program.name })).toBeVisible();
    const card = (await page.locator('#classes [data-slot="card"]').boundingBox())!;
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    for (const [loaded, before] of [
      [heading, skeletonHeading],
      [card, skeletonCard],
    ] as const) {
      expect(Math.abs(loaded.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(loaded.y - before.y)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(card.width - skeletonCard.width)).toBeLessThanOrEqual(1);
  });

  test.describe('a draft program', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { draft } = await seed();
        const response = await page.goto(draft);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await expect.poll(() => consoleGuard.hydrated).toBe(true);
      },
    );
  });
});

test.describe('a published program is listed', () => {
  test('on the organization page under Training, and by Find a program on the Training type', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, program, published } = await seed();
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const section = page.locator('#training');
    await expect(section.getByRole('heading', { level: 2, name: 'Training' })).toBeVisible();
    const row = section.locator('li').filter({ hasText: program.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(PATTERN_TEXT);
    await expect(row).toContainText('Coach Dana Ruiz');
    await expect(row.locator('[data-slot="badge"]')).toHaveText('Registration open');
    await expect(section).not.toContainText('Secret Draft Clinic');
    await row.getByRole('link', { name: program.name }).click();
    await expect(page).toHaveURL(published);
    await expect(page.getByRole('heading', { level: 1, name: program.name })).toBeVisible();

    const token = program.slug.replace('serving-clinic-', '');
    await page.goto(`/programs?type=training&q=${token}`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const found = page.getByRole('main').locator('ul > li').filter({ hasText: program.name });
    await expect(found).toHaveCount(1);
    await expect(found.locator('[data-slot="badge"]').first()).toHaveText('Training');
    await expect(found).toContainText(PATTERN_TEXT);
    await expect(
      page
        .getByRole('navigation', { name: 'Program type' })
        .getByRole('link', { name: 'Training' }),
    ).toHaveAttribute('aria-current', 'page');
    await found.getByRole('link', { name: program.name }).click();
    await expect(page).toHaveURL(published);
  });

  test('a draft program, and one whose classes have all passed, are on neither list', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seedTenantWithPlace('E2E Training Unlisted');
    const token = randomBytes(3).toString('hex');
    await seedPublishedTraining(
      tenant,
      clinic({ name: `Draft ${token}`, slug: `draft-${token}`, status: 'draft' }),
    );
    await seedPublishedTraining(
      tenant,
      clinic({ name: `Ended ${token}`, slug: `ended-${token}`, classes: classes(-30, 2) }),
    );
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('#training')).toHaveCount(0);
    await page.goto(`/programs?type=training&q=${token}`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.getByRole('main').getByRole('link', { name: token })).toHaveCount(0);
    await expect(page.getByText('No training programs match')).toBeVisible();
  });
});

const main = (page: Page) => page.getByRole('main');
const publishDialog = (page: Page) => page.getByRole('alertdialog');
const publishButton = (page: Page) => main(page).getByRole('button', { name: 'Publish' });
const stateBadge = (page: Page) => main(page).locator('h1 + div [data-slot="badge"]').first();

async function adminOfDraft(page: Page, scheduled: boolean) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenantWithPlace('E2E Training Publish');
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  const program = clinic();
  const slug = await seedTraining(tenant, program);
  if (scheduled) await seedTrainingClasses(tenant, slug, program.classes);
  return {
    program,
    publicPath: `${tenant.path}/training/${slug}`,
    managePath: `/app/organizations/${tenant.slug}/training/${slug}`,
  };
}

test.describe('Training: the management page and Publish', () => {
  test('an org admin publishes: Cancel changes nothing, Publish confirms, and the public page then answers 200', async ({
    page,
  }, testInfo) => {
    const { program, publicPath, managePath } = await adminOfDraft(page, true);
    await page.goto(managePath);
    await expect(stateBadge(page)).toHaveText('Draft');
    await screenshot(page, testInfo, 'training-draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);

    await publishButton(page).click();
    await expect(publishDialog(page)).toContainText(`Publish ${program.name}?`);
    await expect(publishDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, 'training-publish-dialog');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await publishDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(publishButton(page)).toBeFocused();
    await expect(stateBadge(page)).toHaveText('Draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);

    await publishButton(page).click();
    await publishDialog(page).getByRole('button', { name: 'Publish training program' }).click();
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(stateBadge(page)).toHaveText('Published');
    const notice = main(page).getByRole('status').filter({ hasText: 'is published.' });
    await expect(notice).toContainText(`${program.name} is published.`);
    await expect(notice).toBeFocused();
    await expect(publishButton(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'training-published');
    await expectAccessible(page);
    expect((await page.request.get(publicPath)).status()).toBe(200);

    await notice.getByRole('link', { name: 'View public page' }).click();
    await expect(page).toHaveURL(publicPath);
    await expect(page.getByRole('heading', { level: 1, name: program.name })).toBeVisible();
    await expect(page.locator('#classes')).toContainText('places left');
  });

  test('a program with no class keeps Publish disabled and says to schedule the classes first, and the page stays a draft', async ({
    page,
  }, testInfo) => {
    const { publicPath, managePath } = await adminOfDraft(page, false);
    await page.goto(managePath);
    const button = publishButton(page);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(main(page).getByText('Schedule the classes first.')).toBeVisible();
    await button.click({ force: true });
    await expect(publishDialog(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'training-publish-needs-classes');
    await expect(stateBadge(page)).toHaveText('Draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);
  });
});
