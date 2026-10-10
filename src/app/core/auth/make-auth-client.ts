import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/client';

/**
 * The Better Auth client (ADR 0008 "Angular wiring"): the framework-agnostic `better-auth/client`
 * with the component's `convex` plugin (the Convex JWT endpoint) and `crossDomain` plugin (the app
 * and `*.convex.site` are different sites, so the session lives in `localStorage`). Only the
 * `AUTH_CLIENT` factory calls it, through a dynamic import, so this module and Better Auth's client
 * code (about 40 kB) stay out of the initial bundle.
 */
export function makeAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [convexClient(), crossDomainClient()],
    // ADR 0008 "Cost": by default every tab focus fetches the session again.
    sessionOptions: { refetchOnWindowFocus: false },
  });
}
