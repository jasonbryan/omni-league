import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdMutations } from './support/hold-mutations';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const WIDTHS = [320, 360, 1280] as const;
const TABLET_BREAKPOINT = 768;
const HEIGHT = 800;
const STATUS_LINE = 20;
const TAKEN = 'sand-4s';
const TAKEN_MESSAGE = `${TAKEN} is already taken. Choose another web address.`;

interface Form {
  name: 'tournament' | 'camp' | 'training';
  path: string;
  container: string;
  create: string;
  freeName: string;
  complete(page: Page): Promise<void>;
}

const FORMS: Form[] = [
  {
    name: 'tournament',
    path: 'tournaments',
    container: '#create-tournament',
    create: 'tournaments:create',
    freeName: 'Held Open Cup',
    complete: async (page) => {
      await chooseChip(chipLabel(page, 'Beach volleyball'));
      await chooseChip(chipLabel(page, '2v2'));
      await page.locator('#start-date').fill('2031-01-16');
      await page.locator('#end-date').fill('2031-01-17');
      await page.locator('#registration-deadline').fill('2031-01-09');
      await page.locator('#maximum-teams').fill('16');
    },
  },
  {
    name: 'camp',
    path: 'camps',
    container: '#create-camp',
    create: 'camps:create',
    freeName: 'Held Junior Camp',
    complete: async (page) => {
      await chooseChip(chipLabel(page, 'Beach volleyball'));
      await page.locator('#minimum-age').fill('9');
      await page.locator('#maximum-age').fill('14');
    },
  },
  {
    name: 'training',
    path: 'training',
    container: '#create-training',
    create: 'trainings:create',
    freeName: 'Held Clinic',
    complete: async (page) => {
      await chooseChip(chipLabel(page, 'Beach volleyball'));
      await page.locator('#coach-name').fill('Dana Ruiz');
    },
  },
];

async function openAsAdmin(page: Page, form: Form, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Order Hold',
    locations: [
      { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
    ],
    leagues: [
      {
        name: 'Sand 4s',
        sport: 'beachVolleyball',
        locations: ['Redfish Flats Fields'],
        division: { gender: 'coed', playersPerSide: 4, level: 'b', ageGroup: 'adult' },
      },
    ],
  });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return `/app/organizations/${tenant.slug}/${form.path}`;
}

const slug = (page: Page) => page.locator('#slug');
const status = (page: Page) => page.locator('#slug-availability');
const error = (page: Page) => page.locator('#slug-error');
const slugField = (page: Page) => slug(page).locator('xpath=ancestor::*[@data-slot="field"][1]');
const nextField = (page: Page) => slugField(page).locator('xpath=following-sibling::*[1]');
const submit = (page: Page, form: Form) =>
  page.locator(`${form.container} form button[type="submit"]`);

interface Geometry {
  name: number;
  slug: number;
  next: number;
  pageHeight: number;
}

// Relative to the page, so a scroll between two readings is not a shift.
async function pageTop(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().top + scrollY);
}

async function geometry(page: Page): Promise<Geometry> {
  return {
    name: await pageTop(page.locator('#name')),
    slug: await pageTop(slug(page)),
    next: await pageTop(nextField(page)),
    pageHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  };
}

for (const form of FORMS) {
  for (const width of WIDTHS) {
    test.describe(`${form.name} form at ${width}px`, () => {
      test.beforeEach(({ hasTouch }) => {
        test.skip(hasTouch && width >= TABLET_BREAKPOINT, 'a desktop width is not a phone');
      });

      test('lists the status, the error, then the description under the input, and describes the input by them', async ({
        page,
      }) => {
        await page.goto(await openAsAdmin(page, form, width));
        await expect(slug(page)).toBeVisible();
        const children = () =>
          slugField(page)
            .locator('xpath=./*')
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute('data-slot') ?? node.tagName.toLowerCase()),
            );
        expect(await children()).toEqual([
          'field-label',
          'input',
          'field-status',
          'field-description',
        ]);
        await expect(status(page)).toHaveAttribute('role', 'status');
        await expect(slug(page)).toHaveAttribute('aria-describedby', 'slug-description');

        await slug(page).fill(TAKEN);
        await expect(error(page)).toHaveText(TAKEN_MESSAGE);
        expect(await children()).toEqual([
          'field-label',
          'input',
          'field-status',
          'field-error',
          'field-description',
        ]);
        await expect(slug(page)).toHaveAttribute('aria-describedby', 'slug-error slug-description');
        await expect(page.locator('#slug-description')).toContainText(
          'across its leagues, tournaments, camps, and training programs.',
        );
        await expectAccessible(page);
      });

      test('moves nothing for Available and the next field only by the error height minus the status line', async ({
        page,
      }) => {
        await page.goto(await openAsAdmin(page, form, width));
        const idle = await geometry(page);

        await slug(page).fill('held-free-address');
        await expect(status(page)).toHaveText('Available');
        expect(await geometry(page)).toEqual(idle);
        await expectAccessible(page);

        await slug(page).fill(TAKEN);
        await expect(error(page)).toHaveText(TAKEN_MESSAGE);
        const taken = await geometry(page);
        const errorHeight = (await error(page).boundingBox())!.height;
        expect(taken.name).toBe(idle.name);
        expect(taken.slug).toBe(idle.slug);
        expect(Math.abs(taken.next - idle.next - (errorHeight - STATUS_LINE))).toBeLessThanOrEqual(
          1,
        );
        await expectAccessible(page);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(0);
      });

      test.describe('a held create', () => {
        test.use({ expectedConvexErrors: [form.create] });

        test('keeps Available, then the taken error, in the same place while the create is held, and keeps the refusal in place', async ({
          page,
        }) => {
          const held = await holdMutations(page);
          await page.goto(await openAsAdmin(page, form, width));

          await page.locator('#name').fill(TAKEN);
          await form.complete(page);
          await expect(error(page)).toHaveText(TAKEN_MESSAGE);
          const shown = await error(page).elementHandle();
          const beforePress = await geometry(page);
          held.hold();
          await submit(page, form).click();
          await expect(submit(page, form)).toHaveAttribute('aria-disabled', 'true');
          expect(await shown.evaluate((element) => element.isConnected)).toBe(true);
          await expect(error(page)).toHaveText(TAKEN_MESSAGE);
          expect(await geometry(page)).toEqual(beforePress);
          await expectAccessible(page);
          held.release();
          await expect(submit(page, form)).not.toHaveAttribute('aria-disabled', 'true');
          await expect(error(page)).toHaveText(TAKEN_MESSAGE);
          expect(await geometry(page)).toEqual(beforePress);
          await expect(slug(page)).toHaveAttribute(
            'aria-describedby',
            'slug-error slug-description',
          );
        });
      });

      test.describe('a held create that succeeds', () => {
        test('keeps Available while the create is held, then clears the form after the success', async ({
          page,
        }) => {
          const held = await holdMutations(page);
          await page.goto(await openAsAdmin(page, form, width));

          await page.locator('#name').fill(form.freeName);
          await form.complete(page);
          await expect(status(page)).toHaveText('Available');
          const beforePress = await geometry(page);
          held.hold();
          await submit(page, form).click();
          await expect(submit(page, form)).toHaveAttribute('aria-disabled', 'true');
          await expect(status(page)).toHaveText('Available');
          await expect(error(page)).toHaveCount(0);
          expect(await geometry(page)).toEqual(beforePress);
          await expectAccessible(page);
          held.release();
          await expect(
            page.locator(form.container).getByRole('status').filter({ hasText: 'created' }),
          ).toBeVisible();
          await expect(slug(page)).toHaveValue('');
          await expect(error(page)).toHaveCount(0);
        });
      });
    });
  }
}
