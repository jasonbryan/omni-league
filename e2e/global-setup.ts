import type { FullConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { E2E_CONVEX_SCRIPT } from './support/convex';
import { baseURL, LOCAL_CONVEX_URL, LOCAL_PORT, remoteBaseUrl } from './support/env';

/**
 * Locally, sets IS_TEST=true on the local Convex backend and resets it once; tests are isolated by
 * their own data, not by further resets.
 */
export default function globalSetup(config: FullConfig): void {
  const projects = config.projects.map((p) => p.name).join(', ');
  if (remoteBaseUrl) {
    console.log(`E2E target: ${baseURL} (E2E_BASE_URL; no local server or Convex backend started)`);
    console.log(
      'E2E: hydration-log assertion and /%E0%A4%A check skipped (they need the local development build)',
    );
  } else {
    console.log(`E2E target: ${baseURL} (npm run serve:ssr, PORT=${LOCAL_PORT})`);
    console.log(`E2E Convex: ${LOCAL_CONVEX_URL} (anonymous local backend)`);
    execFileSync(process.execPath, [E2E_CONVEX_SCRIPT, 'setup'], { stdio: 'inherit' });
  }
  console.log(`E2E projects: ${projects}`);
}
