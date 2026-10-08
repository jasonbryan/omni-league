import type { FullConfig } from '@playwright/test';
import { baseURL, LOCAL_PORT, remoteBaseUrl } from './support/env';

/** Prints the run's target, so the job log and pasted local output show what was tested. */
export default function globalSetup(config: FullConfig): void {
  const projects = config.projects.map((p) => p.name).join(', ');
  if (remoteBaseUrl) {
    console.log(`E2E target: ${baseURL} (E2E_BASE_URL; no local server started)`);
    console.log(
      'E2E: hydration-log assertion and /%E0%A4%A check skipped (they need the local development build)',
    );
  } else {
    console.log(`E2E target: ${baseURL} (npm run serve:ssr, PORT=${LOCAL_PORT})`);
  }
  console.log(`E2E projects: ${projects}`);
}
