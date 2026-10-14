import type { SwRegistrationOptions } from '@angular/service-worker';

declare global {
  const __SERVICE_WORKER__: boolean;
}

export const SERVICE_WORKER_BUILD: boolean =
  typeof __SERVICE_WORKER__ !== 'undefined' && __SERVICE_WORKER__;

/**
 * The app registers the worker only in a production build that has it, so the kill switch is one setting: removing the `serviceWorker` option
 * from angular.json stops both the worker build and its registration, and no client requests the missing `ngsw-worker.js`.
 */
export function serviceWorkerRegistration(
  workerBuilt: boolean,
  devMode: boolean,
): SwRegistrationOptions {
  return { enabled: workerBuilt && !devMode, registrationStrategy: 'registerWhenStable:30000' };
}
