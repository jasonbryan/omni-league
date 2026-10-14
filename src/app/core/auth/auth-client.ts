import { isPlatformBrowser } from '@angular/common';
import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { normalizeConvexUrl } from '../data/convex/convex-url';
import type { makeAuthClient } from './make-auth-client';

export type AuthClient = ReturnType<typeof makeAuthClient>;

export type AuthClientLike = Pick<
  AuthClient,
  'useSession' | 'signUp' | 'signIn' | 'signOut' | 'convex' | 'getCookie'
>;

export const AUTH_BASE_URL = new InjectionToken<string | null>('AUTH_BASE_URL', {
  providedIn: 'root',
  factory: () =>
    normalizeConvexUrl(typeof __CONVEX_SITE_URL__ === 'undefined' ? null : __CONVEX_SITE_URL__),
});

/** Browser only. During a server render it is always `null`, so no auth code runs there. */
export const AUTH_CLIENT = new InjectionToken<Promise<AuthClientLike> | null>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return null;
    const baseURL = inject(AUTH_BASE_URL);
    if (baseURL === null) return null;
    return import('./make-auth-client').then(({ makeAuthClient }) => makeAuthClient(baseURL));
  },
});
