import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { seedPublishedCamp } from './support/camp';
import { seedCampRegistration, seedCampWaitlistEntry } from './support/camp-registrations';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { homeHeading } from './support/home';
import { expectLinkHeights, pointerOf } from './support/link-heights';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { seedPublishedTraining } from './support/training';
import {
  seedTrainingRegistration,
  seedTrainingWaitlistEntry,
} from './support/training-registrations';
import { newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PLACE = 'Alpha Beach';
const ADDRESS = '1 Alpha Road, Corpus Christi, TX 78412';
const LONG = 'W'.repeat(60);
const LEAGUE = 'Sunday Reverse Coed 4s';
const CAMP_SLUG = 'junior-beach-volleyball-camp';
const SERIES_SLUG = 'tuesday-serving-clinic';
const DROP_IN_SLUG = 'thursday-drop-in-clinic';

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const classes = (firstInDays: number, allowSingleRegistration = false) => ({
  weekday: weekdayOf(dateFromToday(firstInDays)),
  startTime: '18:00',
  endTime: '19:00',
  firstDate: dateFromToday(firstInDays),
  weeks: 3,
  placesPerClass: 12,
  registrationDeadline: dateFromToday(firstInDays - 2),
  allowSingleRegistration,
});

const week = (name: string, startInDays: number, places = 12) => ({
  name,
  startDate: dateFromToday(startInDays),
  endDate: dateFromToday(startInDays + 4),
  dailyStartTime: '09:00',
  dailyEndTime: '12:30',
  places,
  registrationDeadline: dateFromToday(startInDays - 7),
});

const main = (page: Page) => page.getByRole('main');
const programs = (page: Page) => page.getByRole('region', { name: 'Camps and training' });
const teams = (page: Page) => page.getByRole('region', { name: 'Your teams' });
const cardOf = (page: Page, program: string) =>
  programs(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: program }) });

/** The `dd` under the `dt` named `label`. */
const factOf = (card: Locator, label: string) =>
  card
    .locator('dl > div')
    .filter({ has: card.page().locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd');

const guardian = (): TestUser => ({ ...newUser('Guardian'), name: 'Gail Guardian' });

/** `names` are the program names, so a long name checks the wrapping. */
async function seedPrograms(names: { camp?: string; organization?: string } = {}) {
  const tenant = await seedTenant({
    name: names.organization ?? 'E2E Home Programs',
    locations: [{ name: PLACE, address: ADDRESS }],
    leagues: [{ name: LEAGUE, sport: 'beachVolleyball', locations: [PLACE] }],
  });
  await seedPublishedCamp(tenant, {
    name: names.camp ?? 'Junior Beach Volleyball Camp',
    slug: CAMP_SLUG,
    locations: [PLACE],
    minimumAge: 9,
    maximumAge: 17,
    sessions: [week('Week 1', 14), week('Week 4', 35, 1)],
  });
  await seedPublishedTraining(tenant, {
    name: 'Tuesday Serving Clinic',
    slug: SERIES_SLUG,
    locations: [PLACE],
    coachName: 'Dana Ruiz',
    classes: classes(16),
  });
  await seedPublishedTraining(tenant, {
    name: 'Thursday Drop-in Clinic',
    slug: DROP_IN_SLUG,
    locations: [PLACE],
    coachName: 'Dana Ruiz',
    classes: classes(17, true),
  });
  return tenant;
}

/** The shape of the guardian@ demo account: a child registered for Week 1 and waiting for the full Week 4, and a child waiting for a series and for one class. */
async function seedFamily(tenant: Tenant, user: TestUser) {
  const maya = { kind: 'minor', minorName: 'Maya R.' } as const;
  const sam = { kind: 'minor', minorName: 'Sam R.' } as const;
  await seedCampRegistration(tenant, CAMP_SLUG, 'Week 1', user, maya);
  await seedCampWaitlistEntry(tenant, CAMP_SLUG, 'Week 4', user, maya);
  await seedTrainingWaitlistEntry(tenant, DROP_IN_SLUG, user, maya);
  await seedTrainingWaitlistEntry(tenant, DROP_IN_SLUG, user, sam, dateFromToday(24));
  await seedTrainingRegistration(tenant, SERIES_SLUG, user, { kind: 'self' });
}

async function openHome(page: Page) {
  await page.goto('/app');
  await expect(homeHeading(page)).toBeVisible();
}

test.describe('/app: camps and training', () => {
  test('a guardian sees their child’s camp session and the waitlist entries, soonest first', async ({
    page,
  }, testInfo) => {
    const user = guardian();
    await signUp(page, user);
    const tenant = await seedPrograms();
    await seedFamily(tenant, user);
    await openHome(page);

    await expect(page).toHaveTitle('Home | Omni League');
    await expect(programs(page).getByRole('heading', { level: 2 })).toHaveText(
      'Camps and training',
    );
    await expect(main(page)).not.toContainText("You're not on a team yet");
    await expect(programs(page).getByRole('heading', { level: 3 })).toHaveText([
      'Junior Beach Volleyball Camp',
      'Tuesday Serving Clinic',
      'Thursday Drop-in Clinic',
      'Thursday Drop-in Clinic',
      'Junior Beach Volleyball Camp',
    ]);

    const week1 = cardOf(page, 'Junior Beach Volleyball Camp').first();
    await expect(week1).toContainText(`${tenant.name} · Week 1`);
    await expect(week1).toContainText('9 AM to 12:30 PM');
    await expect(week1.locator('dd', { hasText: PLACE })).toBeVisible();
    await expect(factOf(week1, 'Attending')).toHaveText('Maya R.');
    await expect(week1.locator('[data-slot="badge"]')).toHaveCount(0);

    const week4 = cardOf(page, 'Junior Beach Volleyball Camp').last();
    await expect(week4).toContainText(`${tenant.name} · Week 4`);
    await expect(week4.locator('[data-slot="badge"]')).toHaveText('Waitlist, position 1');

    const series = cardOf(page, 'Tuesday Serving Clinic');
    await expect(series).toContainText(`${tenant.name} · Series`);
    await expect(factOf(series, 'Next class')).toBeVisible();
    await expect(factOf(series, 'Attending')).toHaveText('You');

    const dropIn = cardOf(page, 'Thursday Drop-in Clinic');
    await expect(dropIn.first().locator('[data-slot="badge"]')).toHaveText('Waitlist, position 1');
    await expect(factOf(dropIn.first(), 'Attending')).toHaveText('Maya R.');
    await expect(dropIn.last().locator('[data-slot="badge"]')).toHaveText('Waitlist, position 2');
    await expect(factOf(dropIn.last(), 'Class')).toBeVisible();
    await expect(factOf(dropIn.last(), 'Attending')).toHaveText('Sam R.');

    await expectAccessible(page);
    await screenshot(page, testInfo, '367-home-camps-and-training');
  });

  test('a program name opens its public page', async ({ page }) => {
    const user = guardian();
    await signUp(page, user);
    const tenant = await seedPrograms();
    await seedFamily(tenant, user);
    await openHome(page);

    await programs(page).getByRole('link', { name: 'Tuesday Serving Clinic' }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}/training/${SERIES_SLUG}`);
  });

  test('a user whose only items are camps sees the section and not the new-user state', async ({
    page,
  }) => {
    const user = newUser('Camper');
    await signUp(page, user);
    const tenant = await seedPrograms();
    await seedCampRegistration(tenant, CAMP_SLUG, 'Week 1', user, { kind: 'self' });
    await openHome(page);

    await expect(programs(page).getByRole('listitem')).toHaveCount(1);
    await expect(main(page)).not.toContainText("You're not on a team yet");
    await expect(teams(page)).toHaveCount(0);
  });

  test('a user with no camp or training registration sees no section, whatever others hold', async ({
    page,
  }) => {
    const other = await seedUser(newUser('Parent'));
    const tenant = await seedPrograms();
    await seedFamily(tenant, other);
    await signUp(page, newUser('Bystander'));
    await openHome(page);

    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();
    await expect(programs(page)).toHaveCount(0);
    await expect(main(page)).not.toContainText('Maya R.');
  });

  test('a registration made while the home is open takes the new-user state away', async ({
    page,
  }) => {
    const user = newUser('Camper');
    await signUp(page, user);
    const tenant = await seedPrograms();
    await openHome(page);
    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();

    await seedCampRegistration(tenant, CAMP_SLUG, 'Week 1', user, { kind: 'self' });
    await expect(programs(page).getByRole('listitem')).toHaveCount(1);
    await expect(main(page)).not.toContainText("You're not on a team yet");
  });

  test('program links are 44px tall on touch screens and keep their size with a mouse', async ({
    page,
  }, testInfo) => {
    const user = guardian();
    await signUp(page, user);
    const tenant = await seedPrograms();
    await seedFamily(tenant, user);
    await openHome(page);

    await expectLinkHeights(page, programs(page).getByRole('link'), pointerOf(testInfo));
  });
});

interface Box {
  x: number;
  y: number;
  width: number;
}

const boxOf = async (locator: Locator): Promise<Box> => {
  const { x, y, width } = (await locator.boundingBox())!;
  return { x, y, width };
};

const skeleton = {
  heading: (page: Page) => page.locator('[data-slot="home-skeleton-heading"]'),
  card: (page: Page) => page.locator('[data-slot="home-skeleton-card"]').first(),
};

async function expectWhereItStood(arrived: Locator, stood: Box, what: string) {
  const now = await boxOf(arrived);
  expect(
    Math.abs(now.y - stood.y),
    `${what} moved from y ${stood.y} to ${now.y}`,
  ).toBeLessThanOrEqual(4);
  expect(
    Math.abs(now.x - stood.x),
    `${what} moved from x ${stood.x} to ${now.x}`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(now.width - stood.width),
    `${what} changed from ${stood.width} to ${now.width}`,
  ).toBeLessThanOrEqual(1);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(clientWidth);
}

async function loadHeld(page: Page) {
  const held = await holdQueries(page, ['campRegistrations:listMine']);
  await page.goto('/app');
  await expect.poll(() => held.isHolding()).toBe(true);
  await expect(main(page).getByRole('status')).toHaveText('Loading your teams and registrations.');
  return held;
}

async function expectLongNamesArriveWhereTheSkeletonStood(page: Page, testInfo: TestInfo) {
  const user = { ...guardian(), name: LONG };
  await signUp(page, user);
  const tenant = await seedPrograms({ camp: LONG, organization: `${LONG} Org` });
  await seedFamily(tenant, user);
  for (const child of ['M'.repeat(60), 'Ana R.', 'Ben R.']) {
    await seedCampRegistration(tenant, CAMP_SLUG, 'Week 1', user, {
      kind: 'minor',
      minorName: child,
    });
  }
  const held = await loadHeld(page);

  const stood = {
    h1: await boxOf(homeHeading(page)),
    heading: await boxOf(skeleton.heading(page)),
    card: await boxOf(skeleton.card(page)),
  };
  await screenshot(page, testInfo, '367-home-loading');
  held.release();
  await expect(programs(page)).toBeVisible();
  await expect(main(page).getByRole('status')).toHaveCount(0);

  await expectWhereItStood(homeHeading(page), stood.h1, 'the greeting');
  await expectWhereItStood(
    programs(page).getByRole('heading', { level: 2 }),
    stood.heading,
    'the heading',
  );
  await expectWhereItStood(
    programs(page).getByRole('listitem').first(),
    stood.card,
    'the first card',
  );
  await expectNoHorizontalScroll(page);
  await screenshot(page, testInfo, '367-home-long-names');
}

async function expectTeamCardsArriveWhereTheSkeletonStood(page: Page) {
  const user = guardian();
  await signUp(page, user);
  const tenant = await seedPrograms();
  await seedFamily(tenant, user);
  await seedSeasons(tenant, 'sunday-reverse-coed-4s', [
    {
      name: 'Summer 2099',
      slug: 'summer-2099',
      startDate: '2099-06-06',
      endDate: '2099-08-29',
      registrationDeadline: dateFromToday(10),
      playersPerSide: 4,
    },
  ]);
  await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: 'sunday-reverse-coed-4s',
    seasonSlug: 'summer-2099',
    name: LONG,
    captainEmail: user.email,
  });
  const held = await loadHeld(page);

  const stood = {
    h1: await boxOf(homeHeading(page)),
    heading: await boxOf(skeleton.heading(page)),
  };
  held.release();
  await expect(teams(page)).toBeVisible();
  await expect(programs(page)).toBeVisible();

  await expectWhereItStood(homeHeading(page), stood.h1, 'the greeting');
  await expectWhereItStood(
    teams(page).getByRole('heading', { level: 2 }),
    stood.heading,
    'the heading',
  );
  const [above, below] = [await boxOf(teams(page)), await boxOf(programs(page))];
  expect(below.y).toBeGreaterThan(above.y);
  await expectNoHorizontalScroll(page);
}

// The two projects run these at 360px and 1280px.
test.describe('/app: the home does not shift when the camp and training rows arrive', () => {
  test('a guardian’s long names and children arrive where the skeleton stood', async ({
    page,
  }, testInfo) => {
    await expectLongNamesArriveWhereTheSkeletonStood(page, testInfo);
  });

  test('a team’s cards arrive where the skeleton stood, with the camp section below them', async ({
    page,
  }) => {
    await expectTeamCardsArriveWhereTheSkeletonStood(page);
  });
});

test.describe('/app: the home does not shift at 320px', () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test('a guardian’s long names and children arrive where the skeleton stood', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'a phone width');
    await expectLongNamesArriveWhereTheSkeletonStood(page, testInfo);
  });

  test('a team’s cards arrive where the skeleton stood, with the camp section below them', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'a phone width');
    await expectTeamCardsArriveWhereTheSkeletonStood(page);
  });
});
