import convexBackend from './convex-backend.json';

/**
 * Run-time settings shared by the Playwright config and the specs.
 *
 * - `E2E_BASE_URL`: target an already running app (for example a Netlify preview, #15). No local
 *   server or Convex backend starts, and the checks that need the local development build are
 *   skipped.
 * - `E2E_WEBKIT=1`: also run the `webkit-mobile` project (release PRs, `workflow_dispatch`).
 */
export const LOCAL_PORT = 4000;
export const LOCAL_BASE_URL = `http://localhost:${LOCAL_PORT}`;
/** The anonymous local Convex backend (#59); version and ports live in `convex-backend.json`. */
export const LOCAL_CONVEX_URL = `http://127.0.0.1:${convexBackend.cloudPort}`;

const rawBaseUrl = process.env['E2E_BASE_URL'];
/** Set only when E2E_BASE_URL is a non-empty string. */
export const remoteBaseUrl: string | undefined =
  rawBaseUrl !== undefined && rawBaseUrl !== '' ? rawBaseUrl : undefined;
export const baseURL = remoteBaseUrl ?? LOCAL_BASE_URL;
export const webkitEnabled = process.env['E2E_WEBKIT'] === '1';

/** Reason used by `test.skip` for checks that only hold against the local development build. */
export const LOCAL_BUILD_ONLY =
  'skipped: E2E_BASE_URL is set; this check needs the local development build and SSR server';
