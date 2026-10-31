// It runs two production builds and its own SSR server, and waits out the 30 s registration window
// (about 2 minutes in all), so `npm run e2e` skips it and the nightly `e2e-production` job runs it.
// Run it with no Convex URL (`CONVEX_URL` unset and absent from `.env.local`) and a free port:
//
//   E2E_KILL_SWITCH=1 E2E_BASE_URL=http://localhost:4100 npx playwright test e2e/pwa-kill-switch.spec.ts
//
// It edits angular.json for the second build and restores it afterwards, even when it fails, and
// leaves the kill-switch build in dist/. It stops the server it started.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

const ROOT = process.cwd();
const ANGULAR_JSON = join(ROOT, 'angular.json');
/** registerWhenStable:30000 registers at the latest 30 s after the app starts; a little more. */
const REGISTRATION_WINDOW_MS = 33_000;

const port = (() => {
  if (!remoteBaseUrl) return undefined;
  const url = new URL(remoteBaseUrl);
  return url.protocol === 'http:' && url.hostname === 'localhost' && url.port !== ''
    ? Number(url.port)
    : undefined;
})();

interface AngularJson {
  projects: Record<string, { architect: { build: { options: Record<string, unknown> } } }>;
}

async function build(): Promise<string> {
  const env = { ...process.env };
  delete env['CONVEX_URL'];
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
  expect(output, 'build with no Convex URL (unset CONVEX_URL, no .env.local)').toContain(
    'Convex URL: none',
  );
  return output;
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

function workerState(page: Page) {
  return page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).length,
    controlled: navigator.serviceWorker.controller !== null,
    caches: (await caches.keys()).length,
  }));
}

test.describe('service worker kill switch (local production builds)', () => {
  test.skip(
    process.env['E2E_KILL_SWITCH'] !== '1' || port === undefined,
    'local rehearsal: E2E_KILL_SWITCH=1 and E2E_BASE_URL=http://localhost:<free port>',
  );

  test.afterAll(async () => {
    await stopServer();
  });

  test('removing the serviceWorker option unregisters an installed client and registers nothing', async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    test.setTimeout(10 * 60_000);
    if (port === undefined) throw new Error('no port');
    const original = await readFile(ANGULAR_JSON, 'utf8');
    const config = JSON.parse(original) as AngularJson;
    const options = config.projects['omni-league']?.architect.build.options;
    expect(options?.['serviceWorker'], 'start from the worker build').toBe('ngsw-config.json');

    const on = await build();
    expect(on).toContain('service worker: on');
    expect(on).toContain('sw-config-check: PASS');
    await startServer(port);
    await page.goto('/');
    await expect
      .poll(async () => (await workerState(page)).controlled, { timeout: 45_000 })
      .toBe(true);
    await expect.poll(async () => (await workerState(page)).caches).toBeGreaterThan(0);
    await stopServer();

    delete options?.['serviceWorker'];
    let off: string;
    try {
      await writeFile(ANGULAR_JSON, `${JSON.stringify(config, null, 2)}\n`);
      off = await build();
    } finally {
      await writeFile(ANGULAR_JSON, original);
    }
    expect(off).toContain('service worker: off');
    expect(off).toContain('sw-config-check: SKIP');
    await startServer(port);
    expect((await page.request.get('/ngsw.json')).status()).toBe(404);

    // A registration attempt would log "A bad HTTP response code (404) ..." and NG05604, which the
    // console fixture reports.
    const contextB = await browser.newContext({ baseURL: remoteBaseUrl });
    const pageB = await contextB.newPage();
    consoleGuard.attach(pageB);
    const openedB = Date.now();
    expect((await pageB.goto('/'))?.status()).toBe(200);

    await page.reload();
    await expect
      .poll(async () => workerState(page), { timeout: 30_000 })
      .toMatchObject({ registrations: 0, caches: 0 });
    const next = await page.reload();
    expect(next?.status()).toBe(200);
    expect(next?.fromServiceWorker()).toBe(false);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    const reloadedA = Date.now();

    await page.waitForTimeout(
      Math.max(0, Math.max(openedB, reloadedA) + REGISTRATION_WINDOW_MS - Date.now()),
    );
    expect(await workerState(page)).toEqual({ registrations: 0, controlled: false, caches: 0 });
    expect(await workerState(pageB)).toEqual({ registrations: 0, controlled: false, caches: 0 });
    await contextB.close();
  });
});
