import type { SwRegistrationOptions } from '@angular/service-worker';

declare global {
  /**
   * `true` when angular.json sets the `serviceWorker` build option, passed by
   * `scripts/ng-convex.mjs` (`npm run build`, `npm start`); `false` otherwise (angular.json default).
   */
  const __SERVICE_WORKER__: boolean;
}

/** Whether this build has the worker; `false` where the define is absent (unit tests). */
export const SERVICE_WORKER_BUILD: boolean =
  typeof __SERVICE_WORKER__ !== 'undefined' && __SERVICE_WORKER__;

/**
 * The `provideServiceWorker` options (ADR 0013 sections 1 and 4, #81). The app registers the worker
 * only in a production build that has it, so the kill switch is one setting: removing the
 * `serviceWorker` option from angular.json stops both the worker build and its registration, and
 * no client requests the missing `ngsw-worker.js` (PR #119 review). Development builds, including
 * the e2e build, never register one.
 */
export function serviceWorkerRegistration(
  workerBuilt: boolean,
  devMode: boolean,
): SwRegistrationOptions {
  return { enabled: workerBuilt && !devMode, registrationStrategy: 'registerWhenStable:30000' };
}
