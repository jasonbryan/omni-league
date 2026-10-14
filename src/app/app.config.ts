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
import { QueryTolerantUrlSerializer } from './core/url-serializer';
import { provideUpdatePrompt } from './shell/update-prompt';
// Not the `./ui/utils` barrel: through it, the eager bundle would share the helm class merging
// (tailwind-merge) with every lazy chunk that uses a helm component.
import { provideSpartanHlm } from './ui/utils/provide-spartan-hlm';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // A query string the router cannot decode (`?ref=%`) is dropped, as the server handler drops it, so hydration keeps the page instead of navigating to `/`.
    { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
    provideClientHydration(),
    provideConvex(),
    // The browser Convex client authenticates with Better Auth's JWT. The server ignores it: AUTH_CLIENT is null there, so server renders stay anonymous.
    provideConvexAuth(AuthService),
    provideSpartanHlm(),
    // Registers a worker only in production builds with angular.json's `serviceWorker` option, so development and kill-switch builds register none.
    provideServiceWorker(
      'ngsw-worker.js',
      serviceWorkerRegistration(SERVICE_WORKER_BUILD, isDevMode()),
    ),
    provideUpdatePrompt(),
  ],
};
