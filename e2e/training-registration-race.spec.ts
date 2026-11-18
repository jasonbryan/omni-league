import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { otherUser, signUp } from './support/session';
import { dateFromToday, seedTenant } from './support/tenant';
import { seedPublishedTraining, setTrainingClassRegistered } from './support/training';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PLACE = 'North Beach Sand Courts';
const FIRST_IN_DAYS = 14;
const WEEK_DAYS = 7;
const PLACES = 12;

const classRows = (page: Page) => page.locator('#classes li');
const placesLeft = (page: Page, index: number) =>
  classRows(page).nth(index).locator('[data-slot="class-places"]');

test.describe('two accounts register for the last place at once', () => {
  test('exactly one takes it, and the other leaves no place taken in any class', async ({
    page,
    browser,
  }) => {
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

    await signUp(page, newUser('First'));
    const second = await otherUser(browser, newUser('Second'));
    try {
      const registerPath = `/app${publicPath}/register`;
      const racers = [page, second];
      for (const racer of racers) {
        await racer.goto(registerPath);
        await expect(racer.getByRole('button', { name: 'Register', exact: true })).toBeVisible();
      }
      await Promise.all(
        racers.map((racer) => racer.getByRole('button', { name: 'Register', exact: true }).click()),
      );

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
      await expect(placesLeft(loser, 2)).toHaveText('0 places left');
      await expect(loser.locator('[data-slot="series-registered"]')).toHaveCount(0);
      await expect(loser.getByRole('link', { name: 'Register for the series' })).toHaveCount(0);
    } finally {
      await second.context().close();
    }
  });
});
