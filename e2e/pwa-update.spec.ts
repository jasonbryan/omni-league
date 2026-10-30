// It runs two production builds and its own SSR server, and waits out the 30 s registration window
// twice (about 4 minutes in all), so `npm run e2e` skips it and the nightly `e2e-production` job runs
// it. Run it with a free port:
//
//   E2E_PWA_UPDATE=1 E2E_BASE_URL=http://localhost:4101 npx playwright test e2e/pwa-update.spec.ts --project=chromium-mobile
//
// The first build uses Convex URL A and the second URL B, as a staging slot or a preview does when
// its deployment is replaced. Convex sockets are mocked: A stays open for two of the clients, as a
// deployment that is still alive, and is closed for the third, as one that was deleted. The second
// build differs from the first by one attribute on `<app-root>`, which `src/app/app.ts` gets for
// that build and loses afterwards, even when the spec fails. It leaves the second build in dist/
// and stops the server it started.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

const ROOT = process.cwd();
const APP_SOURCE = join(ROOT, 'src', 'app', 'app.ts');
const BROWSER_DIST = join(ROOT, 'dist', 'omni-league', 'browser');
const FIRST_CONVEX_URL = 'https://repro-one-111.convex.cloud';
const SECOND_CONVEX_URL = 'https://repro-two-222.convex.cloud';
const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;
const PROMPT_SEEN_KEY = 'e2e-update-prompt-seen';
const NOTE_SEEN_KEY = 'e2e-offline-note-seen';
const OFFLINE_NOTE = '[data-offline-note]';
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

async function build(convexUrl: string): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, CONVEX_URL: convexUrl };
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
let originalAppSource: string | undefined;

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

// sessionStorage survives the reload, so a prompt or note shown before it still counts.
async function recordWhatShows(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ promptKey, noteKey, noteSelector }) => {
      const seen = () => {
        if (document.querySelector('section[aria-labelledby="update-title"]')) {
          sessionStorage.setItem(promptKey, '1');
        }
        if (document.querySelector(noteSelector)) sessionStorage.setItem(noteKey, '1');
      };
      new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    },
    { promptKey: PROMPT_SEEN_KEY, noteKey: NOTE_SEEN_KEY, noteSelector: OFFLINE_NOTE },
  );
}

/** A deployment that is gone refuses the socket without ever opening it, as a deleted Convex deployment does. */
type Deployments = Map<string, 'alive' | 'gone'>;

async function newClient(
  browser: Browser,
  deployments: Deployments = new Map(),
): Promise<{ context: BrowserContext; page: Page; deployments: Deployments }> {
  const context = await browser.newContext({
    baseURL: remoteBaseUrl,
    viewport: { width: 360, height: 800 },
  });
  await context.routeWebSocket(
    (url) => CONVEX_SOCKET.test(url.pathname),
    (ws) => {
      if (deployments.get(new URL(ws.url()).hostname) === 'gone') void ws.close();
    },
  );
  await recordWhatShows(context);
  return { context, page: await context.newPage(), deployments };
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

function noteSeen(page: Page): Promise<string | null> {
  return page.evaluate((key) => sessionStorage.getItem(key), NOTE_SEEN_KEY);
}

test.describe('a new version of the app (local production builds)', () => {
  test.skip(
    process.env['E2E_PWA_UPDATE'] !== '1' || port === undefined,
    'local rehearsal: E2E_PWA_UPDATE=1 and E2E_BASE_URL=http://localhost:<free port>',
  );

  test.afterAll(async () => {
    await stopServer();
    // A timeout abandons the test body before its `finally` runs.
    if (originalAppSource !== undefined) await writeFile(APP_SOURCE, originalAppSource);
  });

  test('loads by itself with no prompt, waits with the prompt while input is unsaved, and replaces a version whose deployment is gone', async ({
    browser,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    expect(false, 'negative check: e2e failures must list this test').toBe(true);
    test.setTimeout(12 * 60_000);
    if (port === undefined) throw new Error('no port');

    await build(FIRST_CONVEX_URL);
    const first = await mainBundle();
    await startServer(port);
    const untouched = await newClient(browser);
    const typing = await newClient(browser);
    const moved = await newClient(browser);
    consoleGuard.attach(untouched.page);
    consoleGuard.attach(typing.page);
    consoleGuard.attach(moved.page);
    await Promise.all([
      installWorker(untouched.page, '/'),
      installWorker(typing.page, '/sign-in'),
      installWorker(moved.page, '/'),
    ]);
    expect(await runningBundle(untouched.page)).toBe(first);
    expect(await runningBundle(typing.page)).toBe(first);
    expect(await runningBundle(moved.page)).toBe(first);
    await stopServer();

    const original = await readFile(APP_SOURCE, 'utf8');
    originalAppSource = original;
    const template = "template: '<router-outlet />',";
    expect(original).toContain(template);
    try {
      await writeFile(
        APP_SOURCE,
        original.replace(template, `${template} host: { 'data-build': 'second' },`),
      );
      await build(SECOND_CONVEX_URL);
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

    await test.step('a page whose Convex deployment is gone ends on the new version with no offline note and no prompt', async () => {
      moved.deployments.set(new URL(FIRST_CONVEX_URL).hostname, 'gone');
      await moved.page.reload();
      // A touched page, so only the rule for a socket that never connected can reload it.
      await moved.page.keyboard.press('Shift');
      await expect
        .poll(() => runningBundle(moved.page), { timeout: UPDATE_WITHIN_MS })
        .toBe(second);
      await expect(moved.page.locator('app-root')).toHaveAttribute('data-build', 'second');
      expect(await noteSeen(moved.page)).toBeNull();
      expect(await promptSeen(moved.page)).toBeNull();
    });

    await test.step('a current version whose deployment cannot be reached says so, not that the user is offline', async () => {
      moved.deployments.set(new URL(SECOND_CONVEX_URL).hostname, 'gone');
      await moved.page.reload();
      await expect(moved.page.locator(OFFLINE_NOTE)).toHaveText(
        "Can't reach Omni League right now. Changes need a connection.",
        { timeout: UPDATE_WITHIN_MS },
      );
      expect(await runningBundle(moved.page)).toBe(second);
    });

    await untouched.context.close();
    await typing.context.close();
    await moved.context.close();
  });
});
