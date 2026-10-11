import { isPlatformBrowser } from '@angular/common';
import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { normalizeConvexUrl } from '../data/convex/convex-url';
import type { makeAuthClient } from './make-auth-client';

export type AuthClient = ReturnType<typeof makeAuthClient>;

/** The part of the client `AuthService` uses; unit tests substitute a fake. */
export type AuthClientLike = Pick<
  AuthClient,
  'useSession' | 'signUp' | 'signIn' | 'signOut' | 'convex' | 'getCookie'
>;

/** The deployment's HTTP-action URL (`*.convex.site`), compiled in by `scripts/ng-convex.mjs`. */
export const AUTH_BASE_URL = new InjectionToken<string | null>('AUTH_BASE_URL', {
  providedIn: 'root',
  factory: () =>
    normalizeConvexUrl(typeof __CONVEX_SITE_URL__ === 'undefined' ? null : __CONVEX_SITE_URL__),
});

/**
 * Browser only: the app's one Better Auth client, loaded from a lazy chunk, or `null` with no
 * Convex site URL. During a server render it is always `null`, so no auth code runs there
 * (ADR 0008 "Server-rendered public pages"). The client is created only here.
 */
export const AUTH_CLIENT = new InjectionToken<Promise<AuthClientLike> | null>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return null;
    const baseURL = inject(AUTH_BASE_URL);
    if (baseURL === null) return null;
    return import('./make-auth-client').then(({ makeAuthClient }) => makeAuthClient(baseURL));
  },
});
