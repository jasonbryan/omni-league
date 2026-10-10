import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, UrlSerializer } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideConvex } from './core/data/convex';
import { QueryTolerantUrlSerializer } from './core/url-serializer';
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
  ],
};
