import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { AuthService } from './core/auth/auth.service';
import { provideConvex, provideConvexAuth } from './core/data/convex';
// Not the `./ui/utils` barrel: through it, the eager bundle would share the helm class merging
// (tailwind-merge) with every lazy chunk that uses a helm component.
import { provideSpartanHlm } from './ui/utils/provide-spartan-hlm';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideConvex(),
    // ADR 0008 "Angular wiring": the browser Convex client authenticates with Better Auth's JWT.
    // The server ignores it: AUTH_CLIENT is null there and server renders stay anonymous.
    provideConvexAuth(AuthService),
    provideSpartanHlm(),
  ],
};
