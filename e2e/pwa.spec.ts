// The service worker on a production build (#81, ADR 0013 sections 1 and 4): the app opens
// offline from the worker, the worker caches only the build files ngsw.json lists, and the
// new-version prompt and the unrecoverable message pass the accessibility checks.
//
// Development builds register no worker (e2e/smoke.spec.ts), so this spec runs only with
// E2E_BASE_URL set, against a production build: locally `npm run build`, `npm run serve:ssr`, then
// `E2E_BASE_URL=http://localhost:4000 npx playwright test e2e/pwa.spec.ts` (not `npm run e2e`, which
// rebuilds dist/ in development mode), or a preview with the Netlify Drawer off. The build has no
// Convex URL, so the offline note follows `navigator.onLine` (docs/process/hosting.md, Service
// worker). `ci` sets no E2E_BASE_URL, so it skips this spec. chromium-mobile only (ADR 0013, CI
// minutes): nothing here depends on the browser project.
import type { Page, TestInfo } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

interface NgswManifest {
  assetGroups: { name: string; urls: string[] }[];
}

/** Every Cache Storage cache of the page's origin and the URLs it holds. */
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

/**
 * Loads `/`, waits for the worker to control the page and to finish prefetching the shell group,
 * then loads `/` once more under the worker, which caches the lazy assets the page uses (fonts).
 */
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

/** Posts a worker event to the page as `ngsw-worker.js` does, so the page's SwUpdate sees it. */
async function workerEvent(page: Page, data: object): Promise<void> {
  await page.evaluate((message) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: message }));
  }, data);
}

/** Removes focus from the focused element, so a screenshot shows no focus ring. */
async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

function skipUnlessMobile(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== 'chromium-mobile',
    'one browser project only (ADR 0013, CI minutes)',
  );
}

test.describe('service worker (production build)', () => {
  test.skip(
    remoteBaseUrl === undefined,
    'needs E2E_BASE_URL and a production build (docs/process/hosting.md, Service worker)',
  );
  // Registration can take up to 30 s (registerWhenStable:30000), then the shell prefetch.
  test.describe.configure({ timeout: 120_000 });

  test('opens / and an unknown path offline in the app shell with the offline note, which clears online', async ({
    page,
    context,
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    await installWorker(page);
    const note = page.locator('header + [role="status"] [data-offline-note]');
    await expect(note).toBeHidden();

    await context.setOffline(true);
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

    // Back online: the note goes within 10 s, with no reload.
    const url = page.url();
    await context.setOffline(false);
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

  // Lazily loaded chunks, such as the phone sheet's (PR #107 testing), come from the worker
  // offline before their first use. sw-config-check fails the build when a chunk is not prefetched.
  test('serves every JavaScript chunk offline, including lazily loaded ones never used online', async ({
    page,
    context,
  }, testInfo) => {
    skipUnlessMobile(testInfo);
    const manifest = await installWorker(page);
    const shell = manifest.assetGroups.find((group) => group.name === 'shell');
    const chunks = (shell?.urls ?? []).filter((url) => /^\/chunk-[^/]+\.js$/.test(url));
    expect(chunks.length).toBeGreaterThan(1);

    await context.setOffline(true);
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

    await workerEvent(page, {
      type: 'VERSION_READY',
      currentVersion: { hash: 'e2e-running' },
      latestVersion: { hash: 'e2e-next' },
    });
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName('A new version of Omni League is ready');
    await expect(status).toHaveText('A new version of Omni League is ready.');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    for (const [width, height, gap] of [
      [360, 800, 12],
      [1280, 720, 16],
    ] as const) {
      await page.setViewportSize({ width, height });
      const box = await card.boundingBox();
      if (!box) throw new Error('no card box');
      // Full width less 12px on phones; 384px at the bottom end corner from 640px.
      expect(box.y + box.height).toBeCloseTo(height - gap, 0);
      if (width === 360) expect(box).toMatchObject({ x: 12, width: 336 });
      else expect(box).toMatchObject({ x: width - 16 - 384, width: 384 });
      // The page makes room for the card and its gap (WCAG 2.4.11); a resize re-measures it.
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

    // Mockup state 2: with the offline note, the note at the top and the card at the bottom.
    await page.setViewportSize({ width: 360, height: 800 });
    await context.setOffline(true);
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
    await context.setOffline(false);
    await expect(note).toBeHidden({ timeout: 10_000 });

    // Later: the card goes for this page session, focus moves to the main region (not <body>), and
    // the page loses its padding.
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
