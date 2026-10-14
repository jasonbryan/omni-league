import convexBackend from './convex-backend.json';

/**
 * - `E2E_BASE_URL`: target an already running app (for example a Netlify preview). No local server
 *   or Convex backend starts, and the checks that need the local development build are skipped.
 * - `E2E_WEBKIT=1`: also run the `webkit-mobile` project (release PRs, `workflow_dispatch`).
 */
export const LOCAL_PORT = 4000;
export const LOCAL_BASE_URL = `http://localhost:${LOCAL_PORT}`;
/** The anonymous local Convex backend; version and ports live in `convex-backend.json`. */
export const LOCAL_CONVEX_URL = `http://127.0.0.1:${convexBackend.cloudPort}`;
export const LOCAL_CONVEX_SITE_URL = `http://127.0.0.1:${convexBackend.sitePort}`;

const rawBaseUrl = process.env['E2E_BASE_URL'];
export const remoteBaseUrl: string | undefined =
  rawBaseUrl !== undefined && rawBaseUrl !== '' ? rawBaseUrl : undefined;
export const baseURL = remoteBaseUrl ?? LOCAL_BASE_URL;
export const webkitEnabled = process.env['E2E_WEBKIT'] === '1';

export const LOCAL_BUILD_ONLY =
  'skipped: E2E_BASE_URL is set; this check needs the local development build and SSR server';
