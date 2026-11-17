// `page.clock` skips the 5-second wait and the client's reconnect back-off, so the test takes a few
// seconds of real time.
import type { Page } from '@playwright/test';
import { axeScan, describeViolations } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import {
  expectSavedCopies,
  organizationCampSavedKeys,
  organizationPageSavedKeys,
  organizationTournamentSavedKeys,
} from './support/saved-copies';
import { dateFromToday, seedSeasons, seedTenant } from './support/tenant';
import { seedBracket } from './support/bracket';
import { seedPublishedCamp, seedTenantWithCamps } from './support/camp';
import { convexRun } from './support/convex';
import { seedPoolPlay, seedPoolResult, seedPoolsStructure } from './support/pools';
import { seedTournament } from './support/tournament';

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

async function firstReconnectLogged(consoleGuard: { logMessages: readonly string[] }) {
  await expect
    .poll(() => consoleGuard.logMessages.some((text) => text.startsWith('Attempting reconnect')))
    .toBe(true);
}

async function scrollPaddingTop(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
}

test.describe('offline note', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');
  test('shows while the socket is refused or the browser is offline, and clears when it returns', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-mobile',
      'one browser project only, to save CI minutes',
    );
    const tenant = await seedTenant({
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const status = page.locator('header + [role="status"]');
    const note = status.locator('[data-offline-note]');

    // Field wifi with no internet: every Convex socket is closed at once while navigator.onLine
    // stays true. The handler never calls connectToServer() while refusing: Playwright would
    // otherwise open a mocked socket, which counts as connected. Playwright has no unroute for
    // WebSocket routes, so "unrouting" switches the handler to pass sockets to the server.
    let refuse = true;
    await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
      if (refuse) {
        void ws.close();
      } else {
        ws.connectToServer();
      }
    });
    await page.clock.install();

    await page.goto(tenant.path);
    await firstReconnectLogged(consoleGuard);
    await expect(note).toBeHidden();
    await page.clock.fastForward(5_000);
    await expect(note).toBeVisible();
    await expect(note).toHaveText("You're offline. Changes need a connection.");
    await expect.poll(() => scrollPaddingTop(page)).toBe('108px');

    // Each fast-forward fires the client's pending reconnect at most once.
    refuse = false;
    await page.clock.fastForward(10_000);
    await expect(note).toBeHidden();
    await expect(status).toHaveText('Back online.');
    await expect.poll(() => scrollPaddingTop(page)).toBe('72px');

    await context.setOffline(true);
    await expect(note).toBeVisible({ timeout: 2_000 });
    await expect(note).toHaveText("You're offline. Changes need a connection.");

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 720 });
      await expect(note).toBeVisible();
      expect(await status.boundingBox()).toMatchObject({ x: 0, y: 65, width });
      const results = await axeScan(page);
      expect(describeViolations(results.violations), `axe violations at ${width}px`).toEqual([]);
      const path = testInfo.outputPath(`offline-note-${width}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`offline-note-${width}.png`, { path, contentType: 'image/png' });
    }
    // At 320px the note wraps to two lines (56px), so the scroll offset follows its measured
    // height.
    await page.setViewportSize({ width: 320, height: 800 });
    await expect.poll(async () => (await note.boundingBox())?.height).toBe(56);
    const noteBox = await status.boundingBox();
    expect(noteBox).toMatchObject({ y: 65, height: 56 });
    await expect.poll(() => scrollPaddingTop(page)).toBe('128px');
    // The header cancels the same amount on itself (shell.ts).
    expect(
      await page.locator('header').evaluate((header) => getComputedStyle(header).scrollMarginTop),
    ).toBe('-128px');
    // The overview has no control of its own, so the test adds a button to main between two
    // spacers: the page can then scroll the button to any offset.
    await page.locator('main').evaluate((main) => {
      const spacer = (height: string) => {
        const element = document.createElement('div');
        element.style.height = height;
        return element;
      };
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Focus target';
      const target = document.createElement('div');
      target.id = 'e2e-focus-target';
      target.append(spacer('1000px'), button, spacer('2000px'));
      main.append(target);
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const button = page.locator('#e2e-focus-target button');
    await expect.poll(async () => (await button.boundingBox())?.y ?? 0).toBeLessThan(0);
    // Chromium centres a focused element it scrolls to, in the scrollport less the padding.
    await button.focus();
    await expect(button).toBeFocused();
    expect((await button.boundingBox())?.y).toBeGreaterThanOrEqual(56 + 56 + 16);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await button.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    expect((await button.boundingBox())?.y).toBe(56 + 56 + 16);
    await page.evaluate(() => {
      document.getElementById('e2e-focus-target')?.remove();
      window.scrollTo(0, 0);
    });
    await page.setViewportSize({ width: 360, height: 800 });

    await context.setOffline(false);
    await page.clock.fastForward(10_000);
    await expect(note).toBeHidden();
  });
});

test.describe('open seasons offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('the section shows from the saved copy, and a season whose deadline has passed since is dropped', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Offline Open',
      locations: [
        { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
        { name: 'Beta Diamond', address: '2 Beta Road, Corpus Christi, TX 78412' },
      ],
      leagues: [
        { name: 'Soccer League', sport: 'soccer', locations: ['Alpha Field'] },
        { name: 'Softball League', sport: 'softball', locations: ['Beta Diamond'] },
      ],
    });
    await seedSeasons(tenant, 'soccer-league', [
      {
        name: 'Soon Season',
        slug: 'soon-season',
        startDate: dateFromToday(20),
        endDate: dateFromToday(80),
        registrationDeadline: dateFromToday(1),
      },
      {
        name: 'Later Season',
        slug: 'later-season',
        startDate: dateFromToday(30),
        endDate: dateFromToday(90),
        registrationDeadline: dateFromToday(10),
      },
    ]);
    const cards = page.locator('#registration-open > ul > li h3 + p');
    const chips = page.getByRole('navigation', { name: 'Sports' });
    await page.clock.install();

    // The sport view is viewed online too, so it has a saved copy to open offline.
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await chips.getByRole('link', { name: /^Soccer/ }).click();
    await expect(cards).toHaveText(['Soon Season', 'Later Season']);
    await chips.getByRole('link', { name: /^All sports/ }).click();
    await expect(page).toHaveURL(tenant.path);
    await expect(page.locator('app-saved-copy-note')).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await chips.getByRole('link', { name: /^Soccer/ }).click();
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(cards).toHaveText(['Soon Season', 'Later Season']);
    await expect(page.getByRole('link', { name: 'Register for a season' })).toBeVisible();

    // Two days on, the saved copy still lists the season; the page applies the date.
    await page.clock.fastForward('48:00:00');
    await expect(cards).toHaveText(['Later Season']);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();

    await context.setOffline(false);
  });
});

test.describe('tournaments offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('the Tournaments section and the open tournaments show from the saved copy, and one that ended since is dropped', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const alpha = { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' };
    const tenant = await seedTenant({
      name: 'E2E Offline Tournaments',
      locations: [alpha],
      leagues: [{ name: 'Soccer League', sport: 'soccer', locations: [alpha.name] }],
      tournaments: [
        {
          name: 'Closing Open',
          slug: 'closing-open',
          locations: [alpha.name],
          startDate: dateFromToday(10),
          endDate: dateFromToday(11),
          registrationDeadline: dateFromToday(1),
        },
        {
          name: 'Later Open',
          slug: 'later-open',
          locations: [alpha.name],
          startDate: dateFromToday(30),
          endDate: dateFromToday(31),
          registrationDeadline: dateFromToday(20),
        },
        {
          name: 'Ends Tomorrow Open',
          slug: 'ends-tomorrow-open',
          locations: [alpha.name],
          startDate: dateFromToday(1),
          endDate: dateFromToday(1),
          registrationDeadline: dateFromToday(-6),
        },
      ],
    });
    const rows = page.locator('#tournaments > ul > li');
    const cards = page.locator('#registration-open > ul > li h3');
    const note = page.locator('app-saved-copy-note');
    await page.clock.install();

    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows.locator('h3')).toHaveText([
      'Ends Tomorrow Open',
      'Closing Open',
      'Later Open',
    ]);
    await expectSavedCopies(page, [
      ...organizationPageSavedKeys(tenant.slug),
      ...organizationTournamentSavedKeys(tenant.slug),
    ]);
    await expect(note).toHaveCount(0);
    await rows.getByRole('link', { name: 'Closing Open', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Closing Open' })).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page).toHaveURL(tenant.path);
    await expect(note).toBeVisible();
    await expect(rows.locator('h3')).toHaveText([
      'Ends Tomorrow Open',
      'Closing Open',
      'Later Open',
    ]);
    await expect(rows.nth(1)).toContainText('Registration open');
    await expect(cards).toHaveText(['Closing Open', 'Later Open']);
    await expect(page.getByRole('link', { name: 'Register for a tournament' })).toBeVisible();

    // Two days on, the saved copy still lists each tournament; the page applies the date.
    await page.clock.fastForward('48:00:00');
    await expect(rows.locator('h3')).toHaveText(['Closing Open', 'Later Open']);
    await expect(rows.first()).toContainText('Registration closed');
    await expect(cards).toHaveText(['Later Open']);
    await expect(note).toBeVisible();

    await context.setOffline(false);
  });
});

test.describe('camps offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('the Camps section and the open camp sessions show from the saved copy, and a camp that ended since is dropped', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const place = { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' };
    const week = (
      name: string,
      startsInDays: number,
      endsInDays: number,
      deadlineInDays: number,
    ) => ({
      name,
      startDate: dateFromToday(startsInDays),
      endDate: dateFromToday(endsInDays),
      places: 20,
      registrationDeadline: dateFromToday(deadlineInDays),
    });
    const camp = (name: string, sessions: ReturnType<typeof week>[]) => ({
      name,
      slug: name.toLowerCase().replace(/ /g, '-'),
      sport: 'soccer' as const,
      locations: [place.name],
      minimumAge: 8,
      maximumAge: 12,
      sessions,
    });
    const tenant = await seedTenantWithCamps(
      {
        name: 'E2E Offline Camps',
        locations: [place],
        leagues: [{ name: 'Soccer League', sport: 'soccer', locations: [place.name] }],
      },
      [
        camp('Closing Camp', [week('Week 1', 4, 8, 1), week('Week 2', 20, 24, 17)]),
        camp('Ends Tomorrow Camp', [week('Week 1', -3, 1, -6)]),
      ],
    );
    const rows = page.locator('#camps > ul > li');
    const cards = page.locator('#registration-open > ul > li');
    const note = page.locator('app-saved-copy-note');
    await page.clock.install();

    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows.locator('h3')).toHaveText(['Ends Tomorrow Camp', 'Closing Camp']);
    await expectSavedCopies(page, [
      ...organizationPageSavedKeys(tenant.slug),
      ...organizationCampSavedKeys(tenant.slug),
    ]);
    await expect(note).toHaveCount(0);
    await rows.getByRole('link', { name: 'Closing Camp', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Closing Camp' })).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page).toHaveURL(tenant.path);
    await expect(note).toBeVisible();
    await expect(rows.locator('h3')).toHaveText(['Ends Tomorrow Camp', 'Closing Camp']);
    await expect(rows.nth(1)).toContainText('Registration open');
    const week1Status = await rows.nth(1).locator('p:last-of-type').innerText();
    await expect(cards.locator('h3')).toHaveText(['Closing Camp', 'Closing Camp']);
    await expect(page.getByRole('link', { name: 'Register for a camp' })).toBeVisible();

    // Two days on, the saved copy still lists each camp; the page applies the date, and the row moves to Week 2, the earliest session still open.
    await page.clock.fastForward('48:00:00');
    await expect(rows.locator('h3')).toHaveText(['Closing Camp']);
    await expect(rows.first()).toContainText('Registration open');
    await expect(rows.first().locator('p:last-of-type')).not.toHaveText(week1Status);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Week 2');
    await expect(note).toBeVisible();

    await context.setOffline(false);
  });
});

test.describe('find a program offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('a search viewed online opens from its saved copy with the note, and another search shows the not-saved view', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Offline Programs',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Alpha Coed League', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const word = tenant.slug.replace(/^e2e-/, '');
    await seedTournament(tenant, {
      name: `Alpha Coed Cup ${word}`,
      slug: 'alpha-coed-cup',
      sport: 'soccer',
      locations: ['Alpha Field'],
      startDate: dateFromToday(40),
      endDate: dateFromToday(41),
    });
    const rows = page.locator('section[aria-labelledby="results-heading"] ul > li h3');
    const field = page.getByRole('searchbox', { name: 'Program, organization, or location' });
    const search = async (q: string) => {
      await field.fill(q);
      await field.press('Enter');
    };

    await page.goto(`/programs?q=${word}`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows).toHaveCount(2);
    await expect(page.locator('app-saved-copy-note')).toHaveCount(0);
    await search(`cup ${word}`);
    await expect(rows).toHaveText([`Alpha Coed Cup ${word}`]);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await search(word);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(rows).toHaveCount(2);

    await search(`never viewed ${word}`);
    await expect(page.locator('app-not-saved-view')).toBeVisible({ timeout: 3_000 });
    await context.setOffline(false);
  });
});

test.describe('find a league by sport offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('a sport view with a filter, viewed online, opens from its saved copy with its filters offered', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    await seedTenant({
      name: 'E2E Offline Youth',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [
        {
          name: '00 Offline Girls',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: { gender: 'womens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
        },
      ],
    });
    const rows = page.locator('section[aria-labelledby="results-heading"] ul > li h3');
    const filters = page.getByRole('search', { name: 'Filter programs' });

    const chips = page.getByRole('navigation', { name: 'Sport' });

    await page.goto('/programs?sport=soccer&age=u10');
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('app-saved-copy-note')).toHaveCount(0);
    await chips.getByRole('link', { name: 'Softball' }).click();
    await expect(page).toHaveURL(/\/programs\?sport=softball&age=u10$/);
    await expect(chips.getByRole('link', { name: 'Softball' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(filters.getByRole('status')).toContainText(/of \d+ softball programs?/);
    await expect(page.getByTestId('find-skeleton')).toHaveCount(0);
    await expect(page.locator('app-saved-copy-note')).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await chips.getByRole('link', { name: 'Soccer' }).click();
    await expect(page).toHaveURL(/\/programs\?sport=soccer&age=u10$/);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(rows.first()).toBeVisible();
    await expect(filters.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(
      filters.getByRole('list', { name: 'Active filters' }).getByRole('link', { name: /^U10/ }),
    ).toBeVisible();

    await context.setOffline(false);
  });
});

test.describe('a tournament page offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('a page viewed online opens from its saved copy with the note, and one never viewed shows the not-saved view', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Offline Tournament',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    });
    const seed = (name: string, slug: string) =>
      seedTournament(tenant, {
        name,
        slug,
        locations: ['Alpha Field'],
        startDate: dateFromToday(30),
        endDate: dateFromToday(31),
        registrationDeadline: dateFromToday(20),
      });
    const viewed = await seed('Viewed Open', 'viewed-open');
    const never = await seed('Never Viewed Open', 'never-viewed-open');
    const note = page.locator('app-saved-copy-note');

    await page.goto(viewed);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: 'Viewed Open' })).toBeVisible();
    await expect(note).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page).toHaveURL(tenant.path);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(viewed);
    await expect(page.getByRole('heading', { level: 1, name: 'Viewed Open' })).toBeVisible();
    await expect(note).toBeVisible();
    await expect(page.locator('#registration')).toContainText('Registration open · closes');

    // The router follows a history entry the way it follows Back, so the page opens without a request.
    await page.evaluate((path) => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, never);
    await expect(
      page.getByRole('heading', { level: 1, name: "This page isn't saved on this device" }),
    ).toBeVisible();
    await expect(note).toHaveCount(0);
    const results = await axeScan(page);
    expect(describeViolations(results.violations)).toEqual([]);

    await context.setOffline(false);
  });

  test('a bracket viewed online opens from its saved copy, with the note', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Offline Bracket',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    });
    const path = await seedTournament(tenant, {
      name: 'Labor Day Sand Slam',
      slug: 'labor-day-sand-slam',
      locations: ['Alpha Field'],
      startDate: dateFromToday(30),
      endDate: dateFromToday(31),
    });
    await seedBracket(tenant, 'labor-day-sand-slam', ['Alpha', 'Bravo', 'Charlie']);
    const games = page.getByTestId('bracket-game');

    await page.goto(path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(games).toHaveCount(3);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page).toHaveURL(tenant.path);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(path);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(page.locator('section#bracket h3')).toHaveText(['Semifinals', 'Final']);
    await expect(games).toHaveCount(3);
    await expect(games.first()).toContainText('(1) Alpha');
    const results = await axeScan(page);
    expect(describeViolations(results.violations)).toEqual([]);

    await context.setOffline(false);
  });
});

test.describe('a pool tournament page offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('the Pools section viewed online opens from its saved copy, with the note', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Offline Pools',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    });
    const path = await seedTournament(tenant, {
      name: 'Fall Pool Play Open',
      slug: 'fall-pool-play-open',
      locations: ['Alpha Field'],
      startDate: dateFromToday(30),
      endDate: dateFromToday(31),
    });
    await seedPoolsStructure(tenant, 'fall-pool-play-open');
    await convexRun('testing:seedTournamentRosters', {
      organizationSlug: tenant.slug,
      tournamentSlug: 'fall-pool-play-open',
      teams: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((name) => ({ name })),
    });
    await seedPoolPlay(tenant, 'fall-pool-play-open', 2);
    await seedPoolResult(tenant, 'fall-pool-play-open', ['Delta', 'Echo'], {
      score: { kind: 'sets', sets: [{ a: 21, b: 15 }] },
    });
    const pools = page.locator('section#pools');

    await page.goto(path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(pools.locator('h3')).toHaveText(['Pool A', 'Pool B']);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page).toHaveURL(tenant.path);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(path);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(pools.locator('h3')).toHaveText(['Pool A', 'Pool B']);
    await expect(pools.locator('table caption')).toHaveText('Pool A standings');
    await expect(pools.locator('tbody th')).toHaveText(['Delta', 'Alpha', 'Echo']);
    await expect(pools.locator('[data-testid="pool-game"]')).toHaveCount(6);
    const results = await axeScan(page);
    expect(describeViolations(results.violations)).toEqual([]);

    await context.setOffline(false);
  });
});

test.describe('a camp page offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('a page viewed online opens from its saved copy with the note, and one never viewed shows the not-saved view', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Offline Camp',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    });
    const seed = (name: string, slug: string) =>
      seedPublishedCamp(tenant, {
        name,
        slug,
        locations: ['Alpha Field'],
        minimumAge: 9,
        maximumAge: 14,
        sessions: [
          {
            name: 'Week 1',
            startDate: dateFromToday(30),
            endDate: dateFromToday(34),
            places: 20,
            registrationDeadline: dateFromToday(20),
          },
        ],
      });
    const viewed = await seed('Viewed Camp', 'viewed-camp');
    const never = await seed('Never Viewed Camp', 'never-viewed-camp');
    const note = page.locator('app-saved-copy-note');

    await page.goto(viewed);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: 'Viewed Camp' })).toBeVisible();
    await expect(note).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').first().click();
    await expect(page).toHaveURL(tenant.path);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(viewed);
    await expect(page.getByRole('heading', { level: 1, name: 'Viewed Camp' })).toBeVisible();
    await expect(note).toBeVisible();
    await expect(page.locator('#sessions')).toContainText('20 places left');

    // The router follows a history entry the way it follows Back, so the page opens without a request.
    await page.evaluate((path) => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, never);
    await expect(
      page.getByRole('heading', { level: 1, name: "This page isn't saved on this device" }),
    ).toBeVisible();
    await expect(note).toHaveCount(0);
    const results = await axeScan(page);
    expect(describeViolations(results.violations)).toEqual([]);

    await context.setOffline(false);
  });
});
