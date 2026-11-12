// Development builds register no worker, so this spec runs only with E2E_BASE_URL set, against a
// production build: locally `npm run build`, `npm run serve:ssr`, then
// `E2E_BASE_URL=http://localhost:4000 npx playwright test e2e/pwa.spec.ts` (not `npm run e2e`,
// which rebuilds dist/ in development mode), or a preview with the Netlify Drawer off. A local
// build has no Convex URL, so the offline note follows `navigator.onLine` (docs/process/hosting.md,
// Service worker). A preview has one; its Convex sockets are routed (`routeConvexSockets`). The
// saved-copy tests need page data: a build against a backend seeded by `seed:demo` (a preview, or
// the local sequence in docs/process/hosting.md, Service worker). Without it they are skipped with
// that reason.
import type { BrowserContext, Page, Request, Route, TestInfo } from '@playwright/test';
import { DEMO } from '../convex/seed';
import { OFFLINE_SAVED_QUERIES } from '../src/app/core/data/convex/offline-saved-queries';
import { initials } from '../src/app/organizations/initials';
import { expectAccessible } from './support/a11y';
import { baseURL, LOCAL_CONVEX_SITE_URL, LOCAL_CONVEX_URL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { expectedOpenCards } from './support/open-seasons';
import { expectLogoLoaded } from './support/organization-mark';
import {
  expectSavedCopies,
  organizationHeaderSavedKey,
  organizationPageSavedKeys,
} from './support/saved-copies';
import { signUp } from './support/session';
import { newUser, type TestUser } from './support/users';

interface NgswManifest {
  assetGroups: { name: string; urls: string[] }[];
}

let offline = false;
let fieldWifi = false;
let firstSocketOrigin: string | undefined;

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

function socketHttpOrigin(socketUrl: string): string {
  const url = new URL(socketUrl);
  return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
}

/**
 * Offline, Chromium logs every socket that fails to connect as a console error
 * (`net::ERR_INTERNET_DISCONNECTED`), which the console fixture reports. So while `setOffline` has
 * the context offline, or in field-wifi mode, the route closes the Convex sockets at once and never
 * calls `connectToServer()` (Playwright would otherwise open a mocked socket, which the client
 * counts as connected).
 */
async function routeConvexSockets(
  context: BrowserContext,
  { localOnly = false }: { localOnly?: boolean } = {},
): Promise<void> {
  offline = false;
  fieldWifi = false;
  firstSocketOrigin = undefined;
  await context.routeWebSocket(CONVEX_SOCKET, (ws) => {
    const origin = socketHttpOrigin(ws.url());
    firstSocketOrigin ??= origin;
    if (offline || fieldWifi || (localOnly && origin !== LOCAL_CONVEX_URL)) void ws.close();
    else ws.connectToServer();
  });
}

async function setOffline(context: BrowserContext, value: boolean): Promise<void> {
  offline = value;
  await context.setOffline(value);
}

async function cacheContents(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const contents: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      contents[name] = (await cache.keys()).map((request) => request.url);
    }
    return contents;
  });
}

async function installWorker(page: Page): Promise<NgswManifest> {
  const manifest = (await (await page.request.get('/ngsw.json')).json()) as NgswManifest;
  const shell = manifest.assetGroups.find((group) => group.name === 'shell');
  expect(shell?.urls.length).toBeGreaterThan(0);
  await page.goto('/');
  // registerWhenStable:30000 registers once the app is stable, at the latest after 30 s.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 45_000,
    })
    .toBe(true);
  await expect
    .poll(
      async () => {
        const contents = await cacheContents(page);
        const name = Object.keys(contents).find((key) => key.endsWith(':assets:shell:cache'));
        return name ? contents[name]?.length : 0;
      },
      { timeout: 30_000 },
    )
    .toBe(shell?.urls.length);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  return manifest;
}

async function workerEvent(page: Page, data: object): Promise<void> {
  await page.evaluate((message) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: message }));
  }, data);
}

async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

function skipUnlessMobile(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'chromium-mobile',
    'one browser project only, to save CI minutes',
  );
}

test.describe('service worker (production build)', () => {
  test.skip(
    remoteBaseUrl === undefined,
    'needs E2E_BASE_URL and a production build (docs/process/hosting.md, Service worker)',
  );
  // Registration can take up to 30 s (registerWhenStable:30000), then the shell prefetch.
  test.describe.configure({ timeout: 120_000 });
  test.beforeEach(async ({ context }) => {
    await routeConvexSockets(context);
  });

  test('opens / and an unknown path offline in the app shell with the offline note, which clears online', async ({
    page,
    context,
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    await installWorker(page);
    const note = page.locator('header + [role="status"] [data-offline-note]');
    await expect(note).toBeHidden();

    await setOffline(context, true);
    const home = await page.reload();
    expect(home?.status()).toBe(200);
    expect(home?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await expect(note).toHaveText("You're offline. Changes need a connection.");

    const unknown = await page.goto('/never-visited/offline-path');
    expect(unknown?.status()).toBe(200);
    expect(unknown?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(note).toBeVisible();

    const url = page.url();
    await setOffline(context, false);
    await expect(note).toBeHidden({ timeout: 10_000 });
    expect(page.url()).toBe(url);
  });

  test('caches only the asset URLs ngsw.json lists, and nothing from Convex or /api/', async ({
    page,
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    const manifest = await installWorker(page);
    const listed = new Set(manifest.assetGroups.flatMap((group) => group.urls));
    const origin = new URL(page.url()).origin;
    const contents = await cacheContents(page);
    const names = Object.keys(contents);
    expect(names.some((name) => name.includes(':assets:'))).toBe(true);
    expect(names.filter((name) => name.includes(':data:'))).toEqual([]);

    for (const [name, urls] of Object.entries(contents)) {
      for (const url of urls) {
        expect(url, `${name} holds no Convex or /api/ URL`).not.toMatch(
          /\.convex\.cloud\b|\.convex\.site\b|\/api\//i,
        );
        if (!name.includes(':assets:')) continue;
        const parsed = new URL(url);
        expect(parsed.origin, `${name}: ${url} is same-origin`).toBe(origin);
        expect(parsed.search, `${name}: ${url} has no query`).toBe('');
        expect(listed.has(parsed.pathname), `${name}: ${url} is listed in ngsw.json`).toBe(true);
      }
    }
  });

  test('serves every JavaScript chunk offline, including lazily loaded ones never used online', async ({
    page,
    context,
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    const manifest = await installWorker(page);
    const shell = manifest.assetGroups.find((group) => group.name === 'shell');
    const chunks = (shell?.urls ?? []).filter((url) => /^\/chunk-[^/]+\.js$/.test(url));
    expect(chunks.length).toBeGreaterThan(1);

    await setOffline(context, true);
    const statuses = await page.evaluate(
      async (urls) =>
        Promise.all(urls.map(async (url) => [url, (await fetch(url)).status] as const)),
      chunks,
    );
    expect(statuses).toEqual(chunks.map((url) => [url, 200]));
  });

  test('the new-version prompt and the unrecoverable message pass the axe helper at 360px and 1280px', async ({
    page,
    context,
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    await installWorker(page);
    const prompt = page.locator('app-update-prompt');
    const card = prompt.locator('section');
    const status = prompt.locator('[role="status"]');
    await expect(card).toHaveCount(0);
    await expect(status).toHaveText('');
    // Unsaved input holds a ready version and the unrecoverable reload, so both cards show instead of the page reloading by itself.
    await page.locator('main').evaluate((main) => {
      const field = document.createElement('input');
      field.setAttribute('aria-label', 'Unsaved note');
      main.append(field);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await workerEvent(page, {
      type: 'VERSION_READY',
      currentVersion: { hash: 'e2e-running' },
      latestVersion: { hash: 'e2e-next' },
    });
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName('A new version of Omni League is ready');
    await expect(status).toHaveText('A new version of Omni League is ready.');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    const PHONE_CARD_INSET = 12;
    const DESKTOP_CARD_INSET = 16;
    const DESKTOP_CARD_WIDTH = 384;
    for (const [width, height, gap] of [
      [360, 800, PHONE_CARD_INSET],
      [1280, 720, DESKTOP_CARD_INSET],
    ] as const) {
      await page.setViewportSize({ width, height });
      const box = await card.boundingBox();
      if (!box) throw new Error('no card box');
      expect(box.y + box.height).toBeCloseTo(height - gap, 0);
      if (width === 360) {
        expect(box).toMatchObject({ x: PHONE_CARD_INSET, width: width - 2 * PHONE_CARD_INSET });
      } else {
        expect(box).toMatchObject({
          x: width - DESKTOP_CARD_INSET - DESKTOP_CARD_WIDTH,
          width: DESKTOP_CARD_WIDTH,
        });
      }
      await expect
        .poll(() =>
          card.evaluate((section, cardGap) => {
            const room = `${String(section.getBoundingClientRect().height + cardGap)}px`;
            return [
              getComputedStyle(document.body).paddingBottom === room,
              getComputedStyle(document.documentElement).scrollPaddingBottom === room,
            ];
          }, gap),
        )
        .toEqual([true, true]);
      // Screenshot first, with no focus: the Tab walk below leaves focus on a control.
      await blurActiveElement(page);
      const path = testInfo.outputPath(`update-prompt-${String(width)}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`update-prompt-${String(width)}.png`, {
        path,
        contentType: 'image/png',
      });
      await expectAccessible(page);
    }

    await page.setViewportSize({ width: 360, height: 800 });
    await setOffline(context, true);
    const note = page.locator('header + [role="status"] [data-offline-note]');
    await expect(note).toBeVisible();
    await expect(card).toBeVisible();
    const noteBox = await note.boundingBox();
    const cardBox = await card.boundingBox();
    if (!noteBox || !cardBox) throw new Error('no note or card box');
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(cardBox.y);
    await blurActiveElement(page);
    const offlinePath = testInfo.outputPath('update-prompt-offline-360.png');
    await page.screenshot({ path: offlinePath });
    await testInfo.attach('update-prompt-offline-360.png', {
      path: offlinePath,
      contentType: 'image/png',
    });
    await setOffline(context, false);
    await expect(note).toBeHidden({ timeout: 10_000 });

    await card.getByRole('button', { name: 'Later' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('main#main')).toBeFocused();
    await expect(status).toHaveText('');
    expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe('0px');

    await workerEvent(page, { type: 'UNRECOVERABLE_STATE', reason: 'e2e' });
    const alert = prompt.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAccessibleName('Omni League needs to reload');
    await expect(alert.getByRole('button')).toHaveText(['Reload']);
    await expect(alert.locator('svg')).toHaveCount(2);
    for (const icon of await alert.locator('svg').all()) await expect(icon).toBeVisible();
    expect(
      await alert
        .locator('svg')
        .evaluateAll((icons) =>
          icons.map((icon) => [
            icon.getBoundingClientRect().width,
            icon.querySelectorAll('*').length,
          ]),
        ),
    ).toEqual([
      [18, 3],
      [16, 2],
    ]);
    for (const [width, height] of [
      [360, 800],
      [1280, 720],
    ] as const) {
      await page.setViewportSize({ width, height });
      await blurActiveElement(page);
      const path = testInfo.outputPath(`update-unrecoverable-${String(width)}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`update-unrecoverable-${String(width)}.png`, {
        path,
        contentType: 'image/png',
      });
      await expectAccessible(page);
    }
  });
});

const [SAVED_ORG, UNUSABLE_ORG, NOT_SAVED_ORG, FIELD_WIFI_ORG] = DEMO;
const orgPath = (slug: string) => `/organizations/${slug}`;
const SAVED_PATH = orgPath(SAVED_ORG.organization.slug);
const ORGANIZATION_LOGO = /^\/api\/storage\/[^/]+$/;
const NOT_SAVED_HEADING = "This page isn't saved on this device";

async function savedAtOf(page: Page, slug: string): Promise<number | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as { savedAt: number }).savedAt;
  }, organizationHeaderSavedKey(slug));
}

async function expectLinksEnabled(page: Page): Promise<void> {
  const links = page.locator('a[href]');
  expect(await links.count()).toBeGreaterThan(0);
  expect(await page.locator('a[aria-disabled], a[disabled]').count()).toBe(0);
}

async function screenshotsAndAxe(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  for (const [width, height] of [
    [360, 800],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    await blurActiveElement(page);
    const path = testInfo.outputPath(`${name}-${String(width)}.png`);
    await page.screenshot({ path });
    await testInfo.attach(`${name}-${String(width)}.png`, { path, contentType: 'image/png' });
    await expectAccessible(page);
  }
  await page.setViewportSize({ width: 360, height: 800 });
}

test.describe('saved copies (production build with seed:demo data)', () => {
  test.skip(
    remoteBaseUrl === undefined,
    'needs E2E_BASE_URL and a production build (docs/process/hosting.md, Service worker)',
  );
  test.describe.configure({ timeout: 120_000 });
  // The saved-copy note shows the time in the device's locale and time zone: fix both.
  test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });
  test.beforeEach(async ({ context, request }, testInfo) => {
    skipUnlessMobile(testInfo);
    const status = (await request.get(SAVED_PATH)).status();
    test.skip(
      status !== 200,
      `${SAVED_PATH} answered ${String(status)}: needs a build against a backend seeded by ` +
        'seed:demo (docs/process/hosting.md, Service worker)',
    );
    await routeConvexSockets(context);
  });

  test.describe('on the demo organization with a logo', () => {
    // A route would turn off the context's HTTP cache; a user's browser has no route and keeps the logo.
    test.use({ netlifyDrawerStub: false });

    test('a page opened online opens offline from its saved copy with the note; the live result replaces it on reconnect', async ({
      page,
      context,
    }, testInfo) => {
      const { organization, leagues, locations } = SAVED_ORG;
      await installWorker(page);
      await page.goto(SAVED_PATH);
      const h1 = page.getByRole('heading', { level: 1, name: organization.name });
      await expect(h1).toBeVisible();
      const mark = page.locator('app-organization-mark');
      await expectLogoLoaded(mark);
      await expectSavedCopies(page, organizationPageSavedKeys(organization.slug));
      const firstSavedAt = (await savedAtOf(page, organization.slug)) ?? 0;
      const savedNote = page.locator('main [data-saved-copy-note]');
      const offlineNote = page.locator('header + [role="status"] [data-offline-note]');
      await expect(savedNote).toHaveCount(0);

      await setOffline(context, true);
      const reload = await page.reload();
      expect(reload?.fromServiceWorker()).toBe(true);
      await expect(h1).toBeVisible();
      await expectLogoLoaded(mark);
      const leagueList = page.locator('#leagues');
      for (const league of leagues) {
        await expect(
          leagueList.getByRole('heading', { level: 3, name: league.name }),
        ).toBeVisible();
      }
      const locationList = page.locator('#locations');
      for (const location of locations) {
        await expect(
          locationList.getByRole('heading', { level: 3, name: location.name }),
        ).toBeVisible();
        await expect(locationList.getByText(location.address)).toBeVisible();
      }
      const registrationOpen = page.locator('#registration-open');
      const expectedCards = expectedOpenCards(organization.slug, Date.now());
      if (expectedCards.length === 0) {
        await expect(registrationOpen.getByText(/^No season is open/)).toBeVisible();
      } else {
        const cards = registrationOpen.locator(':scope > ul > li');
        await expect(cards.getByRole('heading', { level: 3 })).toHaveText(
          expectedCards.map((card) => card.leagueName),
        );
        for (const [i, card] of expectedCards.entries()) {
          await expect(cards.nth(i).getByText(card.seasonName, { exact: true })).toBeVisible();
        }
      }
      await expect(offlineNote).toBeVisible();
      await expect(savedNote).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.querySelector('main h1')?.parentElement?.nextElementSibling?.nextElementSibling
              ?.tagName,
        ),
      ).toBe('APP-SAVED-COPY-NOTE');
      const expectedTime = await page.evaluate(
        (savedAt) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(savedAt),
        firstSavedAt,
      );
      const noteText = ((await savedNote.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      expect(noteText).toBe(
        `Saved copy from today at ${expectedTime.replace(/\s+/g, ' ')}. It may have changed since.`,
      );
      await expect(savedNote.locator('time')).toHaveAttribute(
        'datetime',
        /^\d{4}-\d\d-\d\dT\d\d:\d\d-0[56]:00$/,
      );
      await expectLinksEnabled(page);
      await screenshotsAndAxe(page, testInfo, 'saved-copy-offline');

      await page.evaluate(() => {
        (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
      });
      await setOffline(context, false);
      await expect(savedNote).toHaveCount(0, { timeout: 30_000 });
      await expect(offlineNote).toBeHidden();
      await expect(h1).toBeVisible();
      await expect.poll(() => savedAtOf(page, organization.slug)).toBeGreaterThan(firstSavedAt);
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);
    });

    test('offline, the page needs the header, both lists, and the open seasons saved: any one missing shows the not-saved view', async ({
      page,
      context,
    }) => {
      const { organization } = SAVED_ORG;
      const keys = organizationPageSavedKeys(organization.slug);
      await installWorker(page);
      await page.goto(SAVED_PATH);
      const h1 = page.getByRole('heading', { level: 1, name: organization.name });
      await expect(h1).toBeVisible();
      await expectSavedCopies(page, keys);

      await setOffline(context, true);
      for (const missing of keys) {
        const kept = await page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          localStorage.removeItem(key);
          return raw;
        }, missing);
        expect(kept, missing).not.toBeNull();
        const response = await page.reload();
        expect(response?.fromServiceWorker(), missing).toBe(true);
        await expect(
          page.getByRole('heading', { level: 1, name: NOT_SAVED_HEADING }),
          missing,
        ).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('[data-saved-copy-note]'), missing).toHaveCount(0);

        await page.evaluate(([key, raw]) => localStorage.setItem(key, raw), [
          missing,
          kept!,
        ] as const);
        await page.reload();
        await expect(h1, `${missing} restored`).toBeVisible({ timeout: 5_000 });
        await expect(
          page.locator('main [data-saved-copy-note]'),
          `${missing} restored`,
        ).toBeVisible();
      }
    });

    test.describe('with the HTTP cache off', () => {
      // Playwright disables the HTTP cache in a routed context, so the worker has no copy and answers 504.
      test.use({ expectedFailedRequests: [{ status: 504, path: ORGANIZATION_LOGO }] });

      test('offline, a logo the browser cache does not hold falls back to the initials', async ({
        page,
        context,
      }) => {
        // Playwright disables the HTTP cache in a routed context, as for a user whose cache no longer holds the logo.
        await context.route('**/e2e-never-requested', (route) => route.continue());
        const { organization } = SAVED_ORG;
        await installWorker(page);
        await page.goto(SAVED_PATH);
        const h1 = page.getByRole('heading', { level: 1, name: organization.name });
        await expect(h1).toBeVisible();
        const mark = page.locator('app-organization-mark');
        await expectLogoLoaded(mark);
        await expectSavedCopies(page, organizationPageSavedKeys(organization.slug));

        await setOffline(context, true);
        const reload = await page.reload();
        expect(reload?.fromServiceWorker()).toBe(true);
        await expect(h1).toBeVisible();
        await expect(page.locator('main [data-saved-copy-note]')).toBeVisible();
        await expect(mark.locator('img')).toHaveCount(0);
        await expect(mark).toHaveText(initials(organization.name));
      });
    });
  });

  test('a page never opened shows the not-saved view offline within 5 s, with links enabled', async ({
    page,
    context,
  }, testInfo) => {
    const path = orgPath(NOT_SAVED_ORG.organization.slug);
    await installWorker(page);
    await setOffline(context, true);
    const response = await page.goto(path);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: NOT_SAVED_HEADING })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveTitle('Not saved on this device | Omni League');
    await expect(page.getByRole('main').getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      path,
    );
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expectLinksEnabled(page);
    await screenshotsAndAxe(page, testInfo, 'not-saved-offline');

    // The axe helper's Tab walk leaves focus on the skip link, which then covers the home link:
    // blur it first.
    await blurActiveElement(page);
    await page.getByRole('banner').getByRole('link', { name: 'Omni League' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('field wifi (navigator.onLine true, every Convex socket closed): a page never opened shows the not-saved view within 10 s', async ({
    page,
  }) => {
    const path = orgPath(FIELD_WIFI_ORG.organization.slug);
    await installWorker(page);
    fieldWifi = true;
    const response = await page.goto(path);
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('heading', { level: 1, name: NOT_SAVED_HEADING })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  });
  // A saved value that is not a getPublicPage result of this build is removed and treated as not
  // saved; the console fixture fails the test on any console error.
  test('a saved value of the wrong shape or version is removed: not-saved view offline, the live page online', async ({
    page,
    context,
  }) => {
    const { organization } = UNUSABLE_ORG;
    const path = orgPath(organization.slug);
    const version = OFFLINE_SAVED_QUERIES[0].version;
    const valid = {
      name: organization.name,
      slug: organization.slug,
      leagueCount: 0,
      locationCount: 0,
      sportCount: 0,
      sports: [],
    };
    const unusable: [string, Record<string, unknown>][] = [
      ['{"name":"Shape Only"}', { v: { name: 'Shape Only' }, version }],
      [
        'the earlier shape (lists, no totals)',
        {
          v: { name: organization.name, slug: organization.slug, leagues: [], locations: [] },
          version,
        },
      ],
      ['the later shape (totals, no sports)', { v: { ...valid, sports: undefined }, version }],
      ['42', { v: 42, version }],
      ['"x"', { v: 'x', version }],
      ['[1,2]', { v: [1, 2], version }],
      ['another version', { v: valid, version: version + 1 }],
      ['no version', { v: valid }],
      ['a time in the future', { v: valid, version, savedAt: Date.now() + 365 * 86_400_000 }],
    ];
    const plant = (stored: Record<string, unknown>) =>
      page.evaluate(
        ([key, value]) => {
          localStorage.setItem(key, value);
        },
        [
          organizationHeaderSavedKey(organization.slug),
          JSON.stringify({ savedAt: Date.now(), usedAt: Date.now(), ...stored }),
        ] as const,
      );
    const h1 = page.getByRole('heading', { level: 1 });

    await installWorker(page);
    await setOffline(context, true);
    for (const [label, stored] of unusable) {
      await plant(stored);
      const response = await page.goto(path);
      expect(response?.fromServiceWorker(), label).toBe(true);
      await expect(h1, label).toHaveText(NOT_SAVED_HEADING, { timeout: 5_000 });
      await expect(page.locator('[data-saved-copy-note]'), label).toHaveCount(0);
      expect(await savedAtOf(page, organization.slug), label).toBeNull();
    }

    // Online, the worker serves the shell, so there is no transferred value: the saved copy would
    // show until the live result arrives. An unusable one is removed instead, and the live result
    // saved.
    await setOffline(context, false);
    for (const [label, stored] of unusable) {
      await plant(stored);
      await page.goto(path);
      await expect(h1, label).toHaveText(organization.name, { timeout: 30_000 });
      await expect
        .poll(
          () =>
            page.evaluate(
              (key) =>
                JSON.parse(localStorage.getItem(key) ?? 'null') as {
                  v?: { name?: string };
                  version?: number;
                } | null,
              organizationHeaderSavedKey(organization.slug),
            ),
          { message: label },
        )
        .toMatchObject({ v: { name: organization.name }, version });
    }
  });
});

const ROUTE_FILE_TITLE = 'Account settings | Omni League';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function shellScripts(manifest: NgswManifest): string[] {
  const shell = manifest.assetGroups.find((group) => group.name === 'shell');
  return (shell?.urls ?? []).filter((url) => url.endsWith('.js'));
}

async function scriptsContaining(page: Page, urls: string[], text: string): Promise<string[]> {
  const found: string[] = [];
  for (const url of urls) {
    if ((await (await page.request.get(url)).text()).includes(text)) found.push(url);
  }
  return found;
}

/** `scripts/ng-convex.mjs` compiles the origin into the bundle as the `__CONVEX_URL__` string. */
async function buildConvexUrl(page: Page, manifest: NgswManifest): Promise<string | undefined> {
  if (firstSocketOrigin !== undefined) return firstSocketOrigin;
  const compiled = await scriptsContaining(page, shellScripts(manifest), LOCAL_CONVEX_URL);
  return compiled.length > 0 ? LOCAL_CONVEX_URL : undefined;
}

/**
 * The tests create an account, so each check skips the test with its reason before any request to
 * `/sign-up`.
 */
async function signUpOnLocalBuild(page: Page): Promise<{ manifest: NgswManifest; user: TestUser }> {
  test.skip(
    !LOCAL_HOSTS.has(new URL(baseURL).hostname),
    'E2E_BASE_URL is not local: this test creates an account, so it runs only against a local ' +
      'production build (docs/process/hosting.md, Service worker, With data)',
  );
  const manifest = await installWorker(page);
  const convexUrl = await buildConvexUrl(page, manifest);
  test.skip(
    convexUrl === undefined,
    'no Convex URL found: needs a build against the local backend (docs/process/hosting.md, ' +
      'Service worker, With data)',
  );
  test.skip(
    convexUrl !== LOCAL_CONVEX_URL,
    `the build's Convex URL ${String(convexUrl)} is not ${LOCAL_CONVEX_URL}: this test creates ` +
      'an account, so it needs the local backend (docs/process/hosting.md, Service worker, With data)',
  );
  const status = (await page.request.get(SAVED_PATH)).status();
  test.skip(
    status !== 200,
    `${SAVED_PATH} answered ${String(status)}: needs a build against a backend seeded by ` +
      'seed:demo (docs/process/hosting.md, Service worker)',
  );
  const user = newUser();
  await signUp(page, user);
  return { manifest, user };
}

const OFFLINE_NOTE = "You're offline. Changes need a connection.";
const STORE_KEY = 'better-auth_cookie';
const GET_SESSION_PATH = '/api/auth/get-session';
const SESSION_TOKEN = 'better-auth.session_token';

const offlineNote = (page: Page) => page.locator('header + [role="status"] [data-offline-note]');
const accountRowName = (page: Page, user: TestUser) =>
  page.getByRole('link', { name: `Account settings: ${user.name}` });

function convexSiteRequests(context: BrowserContext): string[] {
  const seen: string[] = [];
  context.on('request', (request) => {
    if (!request.url().startsWith(LOCAL_CONVEX_SITE_URL)) return;
    seen.push(new URL(request.url()).pathname);
  });
  return seen;
}

async function storedSessionToken(page: Page): Promise<string | undefined> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORE_KEY);
  const parsed = JSON.parse(raw ?? '{}') as Record<string, { value?: string } | null>;
  const value = parsed[SESSION_TOKEN]?.value;
  return value === '' ? undefined : value;
}

async function expectAccountRowWithoutUser(page: Page, user: TestUser): Promise<void> {
  await expect(page.locator('app-account-row').first()).toBeAttached();
  for (const text of [user.name, user.email]) {
    await expect(page.locator('body')).not.toContainText(text);
  }
}

test.describe('offline navigation inside the app (production build against the local backend)', () => {
  test.skip(
    remoteBaseUrl === undefined,
    'needs E2E_BASE_URL and a production build (docs/process/hosting.md, Service worker)',
  );
  test.describe.configure({ timeout: 120_000 });
  test.beforeEach(async ({ context }, testInfo) => {
    skipUnlessMobile(testInfo);
    // The test creates an account, so no socket may reach a deployment other than the local one.
    await routeConvexSockets(context, { localOnly: true });
  });

  test('signed in, the account link opens /app offline, with its lazily loaded route file served by the worker', async ({
    page,
    context,
  }) => {
    const { manifest, user } = await signUpOnLocalBuild(page);
    await page.goto('/');
    const accountLink = page
      .getByRole('banner')
      .getByRole('link', { name: `Account: ${user.name}` });
    await expect(accountLink).toBeVisible();

    const chunks = shellScripts(manifest).filter((url) => /^\/chunk-[^/]+\.js$/.test(url));
    const routeFiles = await scriptsContaining(page, chunks, ROUTE_FILE_TITLE);
    expect(routeFiles, `shell chunks holding "${ROUTE_FILE_TITLE}"`).toHaveLength(1);
    const routeFile = routeFiles[0];
    const loaded = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
    );
    expect(loaded, 'the start page already loads the route file').not.toContain(routeFile);

    const scripts: Request[] = [];
    const failed: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(request);
    });
    page.on('requestfailed', (request) => {
      if (request.resourceType() === 'script') failed.push(request.url());
    });
    await setOffline(context, true);
    await accountLink.click();

    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(page).toHaveTitle('Home | Omni League');
    await expect(page.locator('app-account-page')).toBeAttached();
    await expect(offlineNote(page)).toHaveText(OFFLINE_NOTE);
    const responses = await Promise.all(
      scripts.map(async (request) => {
        const response = await request.response();
        return {
          path: new URL(request.url()).pathname,
          status: response?.status(),
          fromServiceWorker: response?.fromServiceWorker(),
        };
      }),
    );
    expect(responses.map((response) => response.path)).toContain(routeFile);
    for (const response of responses) {
      expect(response, response.path).toEqual({
        path: response.path,
        status: 200,
        fromServiceWorker: true,
      });
    }
    expect(failed).toEqual([]);
  });

  test('signed in, an offline reload of /app and a new tab on /app/account stay signed in and load the account back online; a refused token then goes to sign-in', async ({
    page,
    context,
  }) => {
    const { user } = await signUpOnLocalBuild(page);
    await expect(accountRowName(page, user)).toBeVisible();

    await setOffline(context, true);
    // Chromium's offline emulation can hand a leaving document an `online` event, and Better Auth refetches on it, so the requests are counted from a page that loaded offline and never asked.
    await page.goto('/app');
    await expect(page.locator('app-account-page')).toBeAttached();
    await expect(offlineNote(page)).toHaveText(OFFLINE_NOTE);
    const siteRequests = convexSiteRequests(context);
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(page).toHaveTitle('Home | Omni League');
    await expect(page.locator('app-account-page')).toBeAttached();
    await expect(offlineNote(page)).toHaveText(OFFLINE_NOTE);
    await expectAccountRowWithoutUser(page, user);

    const account = await context.newPage();
    await account.goto('/app/account');
    await expect(account).toHaveURL(`${baseURL}/app/account`);
    await expect(
      account.getByRole('heading', { level: 1, name: 'Account settings' }),
    ).toBeVisible();
    await expect(offlineNote(account)).toHaveText(OFFLINE_NOTE);
    expect(siteRequests, 'requests to the Convex site while offline').toEqual([]);

    await setOffline(context, false);
    await expect(accountRowName(page, user)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('main')).toContainText("You're not on a team yet");
    const details = account.getByRole('region', { name: 'Your details' });
    await expect(details).toContainText(user.name, { timeout: 20_000 });
    await expect(details).toContainText(user.email);

    await page.close();
    await setOffline(context, true);
    await account.evaluate(
      ([key, name]) => {
        const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
          string,
          { value: string; expires: string | null }
        >;
        stored[name] = { ...stored[name], value: 'refused-token.refused-signature' };
        localStorage.setItem(key, JSON.stringify(stored));
      },
      [STORE_KEY, SESSION_TOKEN],
    );
    await account.reload();
    await expect(account).toHaveURL(`${baseURL}/app/account`);
    await expect(
      account.getByRole('heading', { level: 1, name: 'Account settings' }),
    ).toBeVisible();

    await setOffline(context, false);
    await expect(account).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fapp%2Faccount`, {
      timeout: 20_000,
    });
    await expect.poll(() => storedSessionToken(account)).toBeUndefined();
  });

  test('signed in on field wifi (sockets closed, get-session never answered), a reload of /app renders at once, and the account loads once the routes are removed', async ({
    page,
    context,
  }) => {
    const { user } = await signUpOnLocalBuild(page);
    await expect(accountRowName(page, user)).toBeVisible();

    const held: Route[] = [];
    const site = `${LOCAL_CONVEX_SITE_URL}/**`;
    await context.route(site, (route) => {
      held.push(route);
    });
    fieldWifi = true;
    await page.reload();
    const loadedAt = Date.now();

    await expect(page.locator('app-account-page')).toBeAttached({ timeout: 3_000 });
    expect(held.map((route) => new URL(route.request().url()).pathname)).toContain(
      '/api/auth/get-session',
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading your teams and registrations.' }),
    ).toBeAttached();
    await expect(page.getByRole('main')).not.toBeEmpty();
    expect(Date.now() - loadedAt).toBeLessThan(3_000);

    await expect(offlineNote(page)).toBeVisible({ timeout: 7_000 - (Date.now() - loadedAt) });
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);

    await context.unroute(site);
    fieldWifi = false;
    await expect(accountRowName(page, user)).toBeVisible({ timeout: 30_000 });
    await expect(offlineNote(page)).toBeHidden();
  });

  test.describe('with the session check answering 503', () => {
    test.use({ expectedFailedRequests: [{ status: 503, path: GET_SESSION_PATH }] });

    test('signed in, the sign-in page a 503 check sent the user to continues to returnTo once the browser is back online, with no press', async ({
      page,
      context,
    }) => {
      const { user } = await signUpOnLocalBuild(page);
      await expect(accountRowName(page, user)).toBeVisible();

      const getSession = `${LOCAL_CONVEX_SITE_URL}${GET_SESSION_PATH}*`;
      // The real answer's CORS headers stay, so the page reads the 503 rather than a failed fetch.
      await context.route(getSession, async (route) =>
        route.fulfill({ response: await route.fetch(), status: 503, body: '' }),
      );
      await page.goto('/sign-in?returnTo=%2Fapp%2Faccount');
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fapp%2Faccount`, {
        timeout: 20_000,
      });
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      expect(await storedSessionToken(page)).toBeDefined();

      await context.unroute(getSession);
      await setOffline(context, true);
      await setOffline(context, false);
      await expect(page).toHaveURL(`${baseURL}/app/account`, { timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
      await expect(page.locator('#main')).toBeFocused();
      await expect(page).toHaveTitle('Account settings | Omni League');
      await expect(page.getByRole('region', { name: 'Your details' })).toContainText(user.name, {
        timeout: 20_000,
      });
    });
  });
});
