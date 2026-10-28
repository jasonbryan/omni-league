// Local only: it runs two production builds and its own SSR server, and waits out the 30 s
// registration window twice (about 4 minutes in all), so `ci` and `npm run e2e` skip it. Run it with
// a free port:
//
//   E2E_PWA_UPDATE=1 E2E_BASE_URL=http://localhost:4101 npx playwright test e2e/pwa-update.spec.ts --project=chromium-mobile
//
// Both builds use one Convex URL, as production does, and the Convex socket is mocked as open. The
// second build differs from the first by one attribute on `<app-root>`, which `src/app/app.ts` gets
// for that build and loses afterwards, even when the spec fails. It leaves the second build in
// dist/ and stops the server it started.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

const ROOT = process.cwd();
const APP_SOURCE = join(ROOT, 'src', 'app', 'app.ts');
const BROWSER_DIST = join(ROOT, 'dist', 'omni-league', 'browser');
const CONVEX_URL = 'https://repro-one-111.convex.cloud';
const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;
const PROMPT_SEEN_KEY = 'e2e-update-prompt-seen';
/** registerWhenStable:30000 registers at the latest 30 s after the app starts; a little more. */
const REGISTRATION_WINDOW_MS = 45_000;
/** The worker checks for a new version about 5 s after the page opens, then downloads it. */
const UPDATE_WITHIN_MS = 15_000;

const port = (() => {
  if (!remoteBaseUrl) return undefined;
  const url = new URL(remoteBaseUrl);
  return url.protocol === 'http:' && url.hostname === 'localhost' && url.port !== ''
    ? Number(url.port)
    : undefined;
})();

async function build(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, CONVEX_URL };
  delete env['CONTEXT'];
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'ng-convex.mjs'), 'build'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  expect(code, `npm run build failed:\n${output}`).toBe(0);
  expect(output).toContain('service worker: on');
}

async function mainBundle(): Promise<string> {
  const names = await readdir(BROWSER_DIST);
  const main = names.filter((name) => /^main-.+\.js$/.test(name));
  expect(main, 'one main bundle in the build').toHaveLength(1);
  return main[0] ?? '';
}

let startedSsrServer: ChildProcess | undefined;

async function startServer(onPort: number): Promise<void> {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'serve-ssr.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(onPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  startedSsrServer = child;
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(`listening on http://localhost:${String(onPort)}`)) resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      reject(new Error(`serve-ssr exited (${String(code)}) on port ${String(onPort)}:\n${output}`));
    });
  });
}

async function stopServer(): Promise<void> {
  const child = startedSsrServer;
  startedSsrServer = undefined;
  if (child?.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

/** Records in `sessionStorage`, which a reload keeps, that the new-version prompt or the unrecoverable message was ever in the page. */
async function recordPrompt(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => {
    const seen = () => {
      if (document.querySelector('section[aria-labelledby="update-title"]')) {
        sessionStorage.setItem(key, '1');
      }
    };
    new MutationObserver(seen).observe(document, { childList: true, subtree: true });
  }, PROMPT_SEEN_KEY);
}

async function newClient(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: remoteBaseUrl,
    viewport: { width: 360, height: 800 },
  });
  await context.routeWebSocket(CONVEX_SOCKET, () => undefined);
  await recordPrompt(context);
  return { context, page: await context.newPage() };
}

async function installWorker(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: REGISTRATION_WINDOW_MS,
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.reload();
}

/** The `main-*.js` the page runs, or undefined while it is loading. */
async function runningBundle(page: Page): Promise<string | undefined> {
  try {
    return await page.evaluate(() => {
      const script = [...document.scripts].find((candidate) =>
        /\/main-[^/]+\.js$/.test(candidate.src),
      );
      return script?.src.split('/').pop();
    });
  } catch {
    return undefined;
  }
}

function promptSeen(page: Page): Promise<string | null> {
  return page.evaluate((key) => sessionStorage.getItem(key), PROMPT_SEEN_KEY);
}

test.describe('a new version of the app (local production builds)', () => {
  test.skip(
    process.env['E2E_PWA_UPDATE'] !== '1' || port === undefined,
    'local rehearsal: E2E_PWA_UPDATE=1 and E2E_BASE_URL=http://localhost:<free port>',
  );

  test.afterAll(async () => {
    await stopServer();
  });

  test('loads by itself with no prompt, and waits with the prompt while input is unsaved', async ({
    browser,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    test.setTimeout(12 * 60_000);
    if (port === undefined) throw new Error('no port');

    await build();
    const first = await mainBundle();
    await startServer(port);
    const untouched = await newClient(browser);
    const typing = await newClient(browser);
    consoleGuard.attach(untouched.page);
    consoleGuard.attach(typing.page);
    await Promise.all([installWorker(untouched.page, '/'), installWorker(typing.page, '/sign-in')]);
    expect(await runningBundle(untouched.page)).toBe(first);
    expect(await runningBundle(typing.page)).toBe(first);
    await stopServer();

    const original = await readFile(APP_SOURCE, 'utf8');
    const template = "template: '<router-outlet />',";
    expect(original).toContain(template);
    try {
      await writeFile(
        APP_SOURCE,
        original.replace(template, `${template} host: { 'data-build': 'second' },`),
      );
      await build();
    } finally {
      await writeFile(APP_SOURCE, original);
    }
    const second = await mainBundle();
    expect(second).not.toBe(first);
    await startServer(port);

    await test.step('an untouched page ends on the new version with no prompt', async () => {
      await untouched.page.reload();
      await expect
        .poll(() => runningBundle(untouched.page), { timeout: UPDATE_WITHIN_MS })
        .toBe(second);
      await expect(untouched.page.locator('app-root')).toHaveAttribute('data-build', 'second');
      expect(await promptSeen(untouched.page)).toBeNull();
    });

    await test.step('a page with typed input stays, shows the prompt, and keeps the value', async () => {
      await typing.page.reload();
      const email = typing.page.locator('#email');
      await email.fill('maya.okafor@example.com');
      await expect(
        typing.page.getByRole('heading', { name: 'A new version of Omni League is ready' }),
      ).toBeVisible({ timeout: UPDATE_WITHIN_MS });
      await typing.page.waitForTimeout(2_000);
      expect(await runningBundle(typing.page)).toBe(first);
      await expect(email).toHaveValue('maya.okafor@example.com');

      await typing.page.getByRole('button', { name: 'Reload' }).click();
      await expect
        .poll(() => runningBundle(typing.page), { timeout: UPDATE_WITHIN_MS })
        .toBe(second);
    });

    await untouched.context.close();
    await typing.context.close();
  });
});
