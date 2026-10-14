import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import {
  baseURL,
  LOCAL_BASE_URL,
  LOCAL_CONVEX_URL,
  LOCAL_PORT,
  remoteBaseUrl,
  webkitEnabled,
} from './e2e/support/env';
import { projectFilter } from './e2e/support/viewport-agnostic';

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
  // 2 on CI: one worker ran the ~500 tests past the 25-minute job timeout. Specs share one local
  // Convex backend and SSR server and each seeds its own uniquely named data, so they are
  // independent of order and of each other.
  workers: ci ? 2 : undefined,
  retries: ci ? 1 : 0,
  // The JSON report names the failing tests in the nightly run's issue.
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: projects.map((project) => ({ ...project, ...projectFilter(project.name ?? '') })),
  // The push and the build run before Playwright (`npm run e2e`), so a failure there is its own
  // step, not a server-start timeout. With E2E_BASE_URL set, no local server or backend starts.
  webServer: remoteBaseUrl
    ? undefined
    : [
        {
          name: 'convex',
          command: 'node scripts/e2e-convex.mjs serve',
          url: `${LOCAL_CONVEX_URL}/version`,
          // Never reuse a backend that is already running: it may be another session's, and
          // globalSetup resets the backend it targets. A busy port fails the run instead.
          reuseExistingServer: false,
          // The first start in a fresh checkout or runner downloads the pinned backend (63.7 MB).
          timeout: 120_000,
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
        },
        {
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
      ],
});
