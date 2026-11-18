import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { otherUser } from './support/session';
import { dateFromToday, seedTenant } from './support/tenant';
import { seedPublishedTraining, setTrainingClassRegistered } from './support/training';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const REGISTRATION = 'trainingRegistrations:getForRegistration';
const PLACE = 'North Beach Sand Courts';
const FIRST_IN_DAYS = 14;
const WEEK_DAYS = 7;
const PLACES = 12;

const classRows = (page: Page) => page.locator('#classes li');
const placesLeft = (page: Page, index: number) =>
  classRows(page).nth(index).locator('[data-slot="class-places"]');

test.describe('two accounts register for the last place at once', () => {
  test('exactly one takes it, and the other leaves no place taken in any class', async ({
    browser,
  }) => {
    test.slow(); // two sign-ups, two page loads each, then a read of the result: over 30 s on a loaded runner
    const token = randomBytes(3).toString('hex');
    const tenant = await seedTenant({
      name: 'E2E Training Race',
      locations: [{ name: PLACE, address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' }],
    });
    const firstDate = dateFromToday(FIRST_IN_DAYS);
    const publicPath = await seedPublishedTraining(tenant, {
      name: `Race Clinic ${token}`,
      slug: `race-clinic-${token}`,
      locations: [PLACE],
      coachName: 'Dana Ruiz',
      classes: {
        weekday: new Date(`${firstDate}T00:00:00Z`).getUTCDay(),
        startTime: '18:00',
        endTime: '19:00',
        firstDate,
        weeks: 3,
        placesPerClass: PLACES,
        registrationDeadline: dateFromToday(FIRST_IN_DAYS - 2),
      },
    });
    const lastClass = dateFromToday(FIRST_IN_DAYS + 2 * WEEK_DAYS);
    await setTrainingClassRegistered(tenant, `race-clinic-${token}`, lastClass, PLACES - 1);

    // Both accounts use their own contexts, which the console guard does not watch: the account that loses logs the server's refusal as a console error, and which one loses is not fixed.
    const first = await otherUser(browser, newUser('First'));
    const second = await otherUser(browser, newUser('Second'));
    try {
      const registerPath = `/app${publicPath}/register`;
      const racers = [first, second];
      const held = [];
      for (const racer of racers) {
        held.push(await holdQueries(racer, [REGISTRATION], { holdFromStart: false }));
        await racer.goto(registerPath);
        await expect(racer.getByRole('button', { name: 'Register', exact: true })).toBeVisible();
      }
      // Each page keeps its form until both presses are sent, so the second press always reaches the server and is refused there.
      for (const hold of held) hold.holdNextAnswer();
      await Promise.all(
        racers.map((racer) => racer.getByRole('button', { name: 'Register', exact: true }).click()),
      );
      for (const hold of held) hold.release();

      const outcome = (racer: Page) =>
        expect
          .poll(
            async () => {
              if (racer.url() === `${baseURL}${publicPath}`) return 'registered';
              return (await racer
                .locator('main [data-slot="alert"]', { hasText: 'full' })
                .count()) > 0
                ? 'refused'
                : 'pending';
            },
            { timeout: 20_000 },
          )
          .not.toBe('pending');
      await Promise.all(racers.map(outcome));
      const winners = racers.filter((racer) => racer.url() === `${baseURL}${publicPath}`);
      expect(winners).toHaveLength(1);
      const [winner] = winners;
      const loser = racers.find((racer) => racer !== winner)!;
      await expect(winner.locator('[data-slot="series-registered"]')).toHaveText(
        "You're registered",
      );
      await expect(loser.locator('main [data-slot="alert"]')).toContainText('full.');

      await winner.goto(registerPath);
      await expect(winner.locator('main [data-slot="alert"]')).toContainText("You're registered");
      await expect(winner.locator('form')).toHaveCount(0);

      await loser.goto(publicPath);
      await expect(classRows(loser)).toHaveCount(3);
      await expect(placesLeft(loser, 0)).toHaveText(`${PLACES - 1} places left`);
      await expect(placesLeft(loser, 1)).toHaveText(`${PLACES - 1} places left`);
      await expect(placesLeft(loser, 2)).toHaveText('Full');
      await expect(loser.locator('[data-slot="series-registered"]')).toHaveCount(0);
      await expect(loser.getByRole('link', { name: 'Register for the series' })).toHaveCount(0);
    } finally {
      await first.context().close();
      await second.context().close();
    }
  });
});

test.describe('two accounts register for the last place of one class at once', () => {
  test('exactly one takes it, and the class and the others keep their counts', async ({
    browser,
  }) => {
    test.slow(); // two sign-ups, two page loads each, then a read of the result: over 30 s on a loaded runner
    const token = randomBytes(3).toString('hex');
    const tenant = await seedTenant({
      name: 'E2E Training Class Race',
      locations: [{ name: PLACE, address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' }],
    });
    const firstDate = dateFromToday(FIRST_IN_DAYS);
    const publicPath = await seedPublishedTraining(tenant, {
      name: `Drop-in Race ${token}`,
      slug: `drop-in-race-${token}`,
      locations: [PLACE],
      coachName: 'Dana Ruiz',
      classes: {
        weekday: new Date(`${firstDate}T00:00:00Z`).getUTCDay(),
        startTime: '18:00',
        endTime: '19:00',
        firstDate,
        weeks: 3,
        placesPerClass: PLACES,
        registrationDeadline: dateFromToday(FIRST_IN_DAYS - 2),
        allowSingleRegistration: true,
      },
    });
    const racedClass = dateFromToday(FIRST_IN_DAYS + WEEK_DAYS);
    await setTrainingClassRegistered(tenant, `drop-in-race-${token}`, racedClass, PLACES - 1);

    const first = await otherUser(browser, newUser('First'));
    const second = await otherUser(browser, newUser('Second'));
    try {
      await first.goto(publicPath);
      const registerPath = await classRows(first)
        .nth(1)
        .locator('a[data-slot="button"]')
        .getAttribute('href');
      expect(registerPath).toMatch(/\/register\?class=/);
      const racers = [first, second];
      const held = [];
      for (const racer of racers) {
        held.push(await holdQueries(racer, [REGISTRATION], { holdFromStart: false }));
        await racer.goto(registerPath!);
        await expect(racer.getByRole('button', { name: 'Register', exact: true })).toBeVisible();
      }
      for (const hold of held) hold.holdNextAnswer();
      await Promise.all(
        racers.map((racer) => racer.getByRole('button', { name: 'Register', exact: true }).click()),
      );
      for (const hold of held) hold.release();

      const outcome = (racer: Page) =>
        expect
          .poll(
            async () => {
              if (racer.url() === `${baseURL}${publicPath}`) return 'registered';
              return (await racer
                .locator('main [data-slot="alert"]', { hasText: 'full' })
                .count()) > 0
                ? 'refused'
                : 'pending';
            },
            { timeout: 20_000 },
          )
          .not.toBe('pending');
      await Promise.all(racers.map(outcome));
      const winners = racers.filter((racer) => racer.url() === `${baseURL}${publicPath}`);
      expect(winners).toHaveLength(1);
      const [winner] = winners;
      const loser = racers.find((racer) => racer !== winner)!;
      await expect(winner.locator('[data-slot="class-registered"]')).toHaveText(
        "You're registered",
      );
      await expect(loser.locator('main [data-slot="alert"]')).toContainText('full');

      await loser.goto(publicPath);
      await expect(classRows(loser)).toHaveCount(3);
      await expect(placesLeft(loser, 0)).toHaveText(`${PLACES} places left`);
      await expect(placesLeft(loser, 1)).toHaveText('Full');
      await expect(placesLeft(loser, 2)).toHaveText(`${PLACES} places left`);
      await expect(loser.locator('[data-slot="class-registered"]')).toHaveCount(0);
      await expect(classRows(loser).nth(1).locator('a[data-slot="button"]')).toHaveCount(0);
    } finally {
      await first.context().close();
      await second.context().close();
    }
  });
});
