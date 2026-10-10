import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, UrlSerializer } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideConvex } from './core/data/convex';
import { QueryTolerantUrlSerializer } from './core/url-serializer';
import { provideUpdatePrompt } from './shell/update-prompt';
// Not the `./ui/utils` barrel: through it, the eager bundle would share the helm class merging
// (tailwind-merge) with every lazy chunk that uses a helm component.
import { provideSpartanHlm } from './ui/utils/provide-spartan-hlm';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // A query string the router cannot decode (`?ref=%`) is dropped, as the server handler drops
    // it, so the page stays after hydration instead of the router navigating to `/` (#91).
    { provide: UrlSerializer, useClass: QueryTolerantUrlSerializer },
    provideClientHydration(),
    provideConvex(),
    provideSpartanHlm(),
    // ADR 0013 section 1 (#81): production builds only, so development builds (including the e2e
    // build) register no worker. Never registered by hand anywhere else (Angular conventions).
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideUpdatePrompt(),
  ],
};
