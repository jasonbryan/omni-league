import convexBackend from './convex-backend.json';

/**
 * - `E2E_BASE_URL`: target an already running app (for example a Netlify preview). No local server
 *   or Convex backend starts, and the checks that need the local development build are skipped.
 * - `E2E_WEBKIT=1`: also run the `webkit-mobile` project, as the `E2E` `workflow_dispatch` does with
 *   `webkit: true`.
 * - `E2E_RUN_NAME=<name>`: write results, traces, and reports under `test-results/<name>/` and
 *   `playwright-report/<name>/`, so several runs in one job keep each other's output.
 */
export const LOCAL_PORT = 4000;
export const LOCAL_BASE_URL = `http://localhost:${LOCAL_PORT}`;
export const LOCAL_CONVEX_URL = `http://127.0.0.1:${convexBackend.cloudPort}`;
export const LOCAL_CONVEX_SITE_URL = `http://127.0.0.1:${convexBackend.sitePort}`;

const rawBaseUrl = process.env['E2E_BASE_URL'];
export const remoteBaseUrl: string | undefined =
  rawBaseUrl !== undefined && rawBaseUrl !== '' ? rawBaseUrl : undefined;
export const baseURL = remoteBaseUrl ?? LOCAL_BASE_URL;
export const webkitEnabled = process.env['E2E_WEBKIT'] === '1';

export const LOCAL_BUILD_ONLY =
  'skipped: E2E_BASE_URL is set; this check needs the local development build and SSR server';

const RUN_NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface RunOutput {
  outputDir: string;
  jsonReport: string;
  htmlReport: string;
}

export function runOutput(runName: string | undefined): RunOutput {
  if (runName === undefined || runName === '') {
    return {
      outputDir: 'test-results',
      jsonReport: 'test-results/results.json',
      htmlReport: 'playwright-report',
    };
  }
  if (!RUN_NAME.test(runName)) {
    throw new Error(
      `E2E_RUN_NAME "${runName}" must be lowercase letters, digits, and hyphens, starting with a letter or digit`,
    );
  }
  return {
    outputDir: `test-results/${runName}`,
    jsonReport: `test-results/${runName}/results.json`,
    htmlReport: `playwright-report/${runName}`,
  };
}
