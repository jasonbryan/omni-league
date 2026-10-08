// Playwright e2e and accessibility harness (ADR 0005, amended by ADR 0009). Usage: README "E2E tests".
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import {
  baseURL,
  LOCAL_BASE_URL,
  LOCAL_PORT,
  remoteBaseUrl,
  webkitEnabled,
} from './e2e/support/env';

const ci = !!process.env['CI'];

// No `channel` anywhere: headless Chromium runs the headless shell, which CI installs with
// `npx playwright install --with-deps --only-shell chromium`.
const projects: PlaywrightTestConfig['projects'] = [
  {
    name: 'chromium-mobile',
    use: {
      browserName: 'chromium',
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    },
  },
  {
    name: 'chromium-desktop',
    use: { browserName: 'chromium', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  },
];
if (webkitEnabled) {
  // iOS Safari proxy: release PRs into `production` and `workflow_dispatch` with `webkit: true`.
  projects.push({
    name: 'webkit-mobile',
    use: {
      browserName: 'webkit',
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
    },
  });
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: ci,
  workers: ci ? 1 : undefined,
  retries: ci ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects,
  // The build runs before Playwright (`npm run e2e`), so a build failure is a build step, not a
  // server-start timeout. With E2E_BASE_URL set, no local server starts.
  webServer: remoteBaseUrl
    ? undefined
    : {
        name: 'app',
        command: 'npm run serve:ssr',
        url: `${LOCAL_BASE_URL}/`, // the prerendered placeholder; reads no Convex data
        env: { PORT: String(LOCAL_PORT) },
        // Never reuse a server that is already running: it may serve a stale or production build.
        reuseExistingServer: false,
        // Readiness accepts HTTP 400, so a rejected Host would look like a 400 in every test;
        // the piped server log names the rejected host instead.
        stdout: 'pipe',
        gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      },
});
