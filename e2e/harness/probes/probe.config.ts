// The outcome of a test that skips itself can only be read from outside the run. No web server: the
// probes use setContent.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.probe\.ts$/,
  outputDir: process.env['PROBE_OUTPUT_DIR'],
  reporter: [['json']],
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', screenshot: 'off', trace: 'off' },
});
