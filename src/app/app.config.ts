import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, UrlSerializer } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { AuthService } from './core/auth/auth.service';
import { provideConvex, provideConvexAuth } from './core/data/convex';
import {
  SERVICE_WORKER_BUILD,
  serviceWorkerRegistration,
} from './core/service-worker/service-worker-build';
import { provideFocusMainAfterNavigation } from './core/focus-main';
import { QueryTolerantUrlSerializer } from './core/url-serializer';
import { provideUpdatePrompt } from './shell/update-prompt';
// Not the `./ui/utils` barrel: through it, the eager bundle would share the helm class merging
// (tailwind-merge) with every lazy chunk that uses a helm component.
import { provideSpartanHlm } from './ui/utils/provide-spartan-hlm';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideFocusMainAfterNavigation(),
    // A query string the router cannot decode (`?ref=%`) is dropped, as the server handler drops
    // it, so the page stays after hydration instead of the router navigating to `/` (#91).
    { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
    provideClientHydration(),
    provideConvex(),
    // ADR 0008 "Angular wiring": the browser Convex client authenticates with Better Auth's JWT.
    // The server ignores it: AUTH_CLIENT is null there and server renders stay anonymous.
    provideConvexAuth(AuthService),
    provideSpartanHlm(),
    // ADR 0013 sections 1 and 4 (#81): production builds with angular.json's `serviceWorker`
    // option only, so development builds (including the e2e build) and the kill-switch build
    // register no worker. Never registered by hand anywhere else (Angular conventions).
    provideServiceWorker(
      'ngsw-worker.js',
      serviceWorkerRegistration(SERVICE_WORKER_BUILD, isDevMode()),
    ),
    provideUpdatePrompt(),
  ],
};
