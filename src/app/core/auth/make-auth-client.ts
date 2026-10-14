import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/client';

/**
 * The app and `*.convex.site` are different sites, so the `crossDomain` plugin keeps the session in `localStorage`. Only the `AUTH_CLIENT`
 * factory calls this, through a dynamic import, so Better Auth's client code (about 40 kB) stays out of the initial bundle.
 */
export function makeAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [convexClient(), crossDomainClient()],
    // By default every tab focus fetches the session again.
    sessionOptions: { refetchOnWindowFocus: false },
  });
}
