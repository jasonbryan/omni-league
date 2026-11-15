import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { chipLabel, chooseChip } from './support/chip';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { PHONE, settleAfterFocusScroll } from './support/sticky-footer';
import { seedSeasons, seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import { expectDescriptionHeightHeldWhileTyping } from './support/web-address-description';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
];

const FORMAT_MESSAGE =
  'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some web addresses, like new, are reserved.';

interface Form {
  name: 'league' | 'season';
  taken: string;
  nameForTaken: string;
  open(page: Page): Promise<void>;
  complete(page: Page): Promise<void>;
  create: string;
  container: string;
}

async function adminOfTenant(page: Page) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Address',
    locations: LOCATIONS,
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
  return { tenant, base: `/app/organizations/${tenant.slug}` };
}

const FORMS: Form[] = [
  {
    name: 'league',
    taken: 'sand-4s',
    nameForTaken: 'Sand 4s',
    container: '#create-league',
    create: 'leagues:create',
    complete: async (page) => {
      await chooseChip(chipLabel(page, 'Beach volleyball'));
      await chooseChip(chipLabel(page, '4v4'));
    },
    open: async (page) => {
      const { base } = await adminOfTenant(page);
      await page.goto(`${base}/leagues`);
    },
  },
  {
    name: 'season',
    taken: 'fall-2026',
    nameForTaken: 'Fall 2026',
    container: '#create-season',
    create: 'seasons:create',
    complete: async (page) => {
      await page.locator('#start-date').fill('2027-03-01');
      await page.locator('#end-date').fill('2027-05-15');
      await page.locator('#registration-deadline').fill('2027-02-20');
    },
    open: async (page) => {
      const { tenant, base } = await adminOfTenant(page);
      await seedSeasons(tenant, 'sand-4s', [
        { name: 'Fall 2026', slug: 'fall-2026', startDate: '2026-09-01', endDate: '2026-11-15' },
      ]);
      await page.goto(`${base}/leagues/sand-4s`);
    },
  },
];

const field = (page: Page) => page.locator('#slug');
const availability = (page: Page) => page.locator('#slug-availability');
const fieldError = (page: Page) => page.locator('#slug-error');
const slugGroup = (page: Page) => field(page).locator('xpath=ancestor::*[@data-slot="field"][1]');
const nextGroup = (page: Page) => slugGroup(page).locator('xpath=following-sibling::*[1]');

const STATUS_LINE = 20;

// A focus scroll centres a control that is wholly out of view and only nudges one that is partly in.
const SLUG_PEEK = 20;

async function scrollSlugJustBelowViewport(page: Page) {
  await expect(page.locator('#slug')).toBeVisible();
  await page.evaluate((peek) => {
    const slug = document.querySelector('#slug')!.getBoundingClientRect();
    scrollBy(0, slug.top - (innerHeight - peek));
  }, SLUG_PEEK);
  const place = await page.evaluate(() => {
    const name = document.querySelector('#name')!.getBoundingClientRect();
    const slug = document.querySelector('#slug')!.getBoundingClientRect();
    return {
      nameOnScreen: name.top >= 0 && name.bottom <= innerHeight,
      slugTop: slug.top,
      height: innerHeight,
    };
  });
  expect(place.nameOnScreen, '#name is on screen').toBe(true);
  expect(place.slugTop, '#slug starts below the footer').toBeGreaterThan(place.height - 96);
}

// The raw rects, with no rounding, as `focusedPlace().aboveFooter` compares them.
async function overlapWithFooter(page: Page, form: Form, shown: Locator): Promise<number> {
  await settleAfterFocusScroll(page);
  const footer = page.locator(`${form.container} form [data-slot="form-footer"]`);
  const footerTop = await footer.evaluate((element) => element.getBoundingClientRect().top);
  const shownBottom = await shown.evaluate((element) => element.getBoundingClientRect().bottom);
  return shownBottom - footerTop;
}

async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return Math.round(box.y);
}

async function leaveByPointer(page: Page, hasTouch: boolean) {
  const name = page.locator('#name');
  if (hasTouch) await name.tap();
  else await name.click();
}

for (const form of FORMS) {
  test.describe(`${form.name} form: web address availability`, () => {
    test('is labelled Web address, with the rule and the full public address under it', async ({
      page,
    }, testInfo) => {
      await form.open(page);
      await expect(page.getByLabel('Web address')).toBeVisible();
      await expect(page.getByText('Slug', { exact: true })).toHaveCount(0);
      const description = page.locator('#slug-description');
      await expect(description).toContainText(
        '3 to 60 lowercase letters and digits, with single hyphens between them.',
      );
      await expect(description).toContainText(`${new URL(page.url()).host}/organizations/`);
      await expect(description).toContainText('your-address');
      await expect(availability(page)).toHaveAttribute('role', 'status');
      await field(page).fill('typed-address');
      await expect(description.locator('strong')).toHaveText('typed-address');
      await screenshot(page, testInfo, `208-${form.name}-web-address`);
      await expectAccessible(page);
    });

    test('keeps the description as tall as for the empty field while the address is typed', async ({
      page,
    }) => {
      await form.open(page);
      await expectDescriptionHeightHeldWhileTyping(page, 'free-address');
    });

    test('says Available for a free address without moving the form below it', async ({
      page,
    }, testInfo) => {
      await form.open(page);
      await field(page).pressSequentially('free-address');
      await expect(page.locator('#slug-description strong')).toHaveText('free-address');
      const before = await top(nextGroup(page));
      await expect(availability(page)).toHaveText('Available');
      expect(await top(nextGroup(page))).toBe(before);
      await expect(fieldError(page)).toHaveCount(0);
      await screenshot(page, testInfo, `208-${form.name}-available`);
      await expectAccessible(page);
    });

    test('keeps the Available status above the sticky footer when a phone keyboard moves to the field', async ({
      page,
      hasTouch,
    }) => {
      test.skip(!hasTouch, 'the sticky footer and the focus scroll are phone behaviour');
      await form.open(page);
      await page.setViewportSize(PHONE);
      await scrollSlugJustBelowViewport(page);
      await field(page).focus();
      await field(page).pressSequentially('free-address');
      await expect(availability(page)).toHaveText('Available');
      expect(await overlapWithFooter(page, form, availability(page))).toBeLessThanOrEqual(0);
    });

    test('says a typed address is taken before any submit, and clears when it is changed', async ({
      page,
    }, testInfo) => {
      await form.open(page);
      await field(page).fill(form.taken);
      await expect(fieldError(page)).toHaveText(
        `${form.taken} is already taken. Choose another web address.`,
      );
      await expect(fieldError(page).locator('strong')).toHaveText(form.taken);
      await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(availability(page)).toHaveText('');
      await screenshot(page, testInfo, `208-${form.name}-taken`);
      await expectAccessible(page);
      await field(page).fill(`${form.taken}-2`);
      await expect(fieldError(page)).toHaveCount(0);
      await expect(availability(page)).toHaveText('Available');
      await field(page).fill('');
      await expect(availability(page)).toHaveText('');
    });

    test('checks the address derived from the name', VIEWPORT_AGNOSTIC, async ({ page }) => {
      await form.open(page);
      await page.locator('#name').fill(form.nameForTaken);
      await expect(field(page)).toHaveValue(form.taken);
      await expect(fieldError(page)).toHaveText(
        `${form.taken} is already taken. Choose another web address.`,
      );
    });

    test('moves the form below it by the error height minus the 20px status line when the address is taken', async ({
      page,
    }) => {
      await form.open(page);
      const free = `${form.taken.slice(0, -1)}x`;
      await field(page).fill(free);
      await expect(availability(page)).toHaveText('Available');
      const before = await top(nextGroup(page));
      await field(page).fill(form.taken);
      await expect(fieldError(page)).toHaveText(
        `${form.taken} is already taken. Choose another web address.`,
      );
      const errorHeight = (await fieldError(page).boundingBox())?.height ?? 0;
      expect(
        Math.abs((await top(nextGroup(page))) - before - (errorHeight - STATUS_LINE)),
      ).toBeLessThanOrEqual(1);
    });

    test('shows an answer for a keyboard user who tabs out of the field', async ({
      page,
      hasTouch,
    }) => {
      test.skip(hasTouch, 'a touch phone has no Tab key');
      await form.open(page);
      await field(page).focus();
      await page.keyboard.type(form.taken);
      await page.keyboard.press('Tab');
      await expect(fieldError(page)).toHaveText(
        `${form.taken} is already taken. Choose another web address.`,
      );
    });

    test('shows an answer for a touch user who taps another field', async ({ page, hasTouch }) => {
      test.skip(!hasTouch, 'needs a touch screen');
      await form.open(page);
      await field(page).tap();
      await page.keyboard.type(form.taken);
      await leaveByPointer(page, hasTouch);
      await expect(fieldError(page)).toHaveText(
        `${form.taken} is already taken. Choose another web address.`,
      );
    });

    test(
      'shows no answer while typing a malformed address, and its message only after leaving',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        await form.open(page);
        await field(page).pressSequentially('Bad-Address');
        await page.waitForTimeout(700);
        await expect(fieldError(page)).toHaveCount(0);
        await expect(availability(page)).toHaveText('');
        await page.locator('#name').focus();
        await expect(fieldError(page)).toHaveText(FORMAT_MESSAGE);
        await expect(availability(page)).toHaveText('');
      },
    );

    test(
      'shows no answer for a reserved address, and its message only after leaving',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        await form.open(page);
        await field(page).pressSequentially('new');
        await page.waitForTimeout(700);
        await expect(fieldError(page)).toHaveCount(0);
        await expect(availability(page)).toHaveText('');
        await page.locator('#name').focus();
        await expect(fieldError(page)).toHaveText(FORMAT_MESSAGE);
      },
    );

    test.describe('a refused Create on a phone', () => {
      test.use({ expectedConvexErrors: [form.create] });

      test('keeps the taken error above the sticky footer', async ({ page, hasTouch }) => {
        test.skip(!hasTouch, 'the sticky footer and the focus scroll are phone behaviour');
        await form.open(page);
        await page.setViewportSize(PHONE);
        await page.locator('#name').fill(form.nameForTaken);
        await form.complete(page);
        await expect(fieldError(page)).toHaveText(
          `${form.taken} is already taken. Choose another web address.`,
        );
        await scrollSlugJustBelowViewport(page);
        await page.locator(`${form.container} form button[type="submit"]`).click();
        await expect(field(page)).toBeFocused();
        await expect(fieldError(page)).toHaveText(
          `${form.taken} is already taken. Choose another web address.`,
        );
        expect(await overlapWithFooter(page, form, fieldError(page))).toBeLessThanOrEqual(0);
      });
    });

    test(
      'never shows the word slug on the field in any state',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        await form.open(page);
        const seen: string[] = [];
        const read = async () => {
          seen.push(
            (await page.locator(form.container).locator('#slug-description').innerText()) +
              (await availability(page).innerText()) +
              ((await fieldError(page).count()) > 0 ? await fieldError(page).innerText() : ''),
          );
        };
        await field(page).fill(form.taken);
        await expect(fieldError(page)).toBeVisible();
        await read();
        await field(page).fill('Bad-Address');
        await page.locator('#name').focus();
        await expect(fieldError(page)).toHaveText(FORMAT_MESSAGE);
        await read();
        await field(page).fill('free-address');
        await expect(availability(page)).toHaveText('Available');
        await read();
        for (const text of seen) expect(text).not.toMatch(/slug/i);
      },
    );
  });
}
