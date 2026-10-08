import { InjectionToken } from '@angular/core';

declare global {
  /** Deployment URL, set by `scripts/ng-convex.mjs` through `--define`; `null` with no URL (angular.json default). */
  const __CONVEX_URL__: string | null;
  /** HTTP-action URL (`*.convex.site`) derived by the wrapper; read by the auth follow-up (ADR 0008). */
  const __CONVEX_SITE_URL__: string | null;
}

/** An empty or missing URL means "not configured". */
export function normalizeConvexUrl(raw: string | null | undefined): string | null {
  return raw === undefined || raw === '' ? null : raw;
}

export const CONVEX_URL = new InjectionToken<string | null>('CONVEX_URL', {
  providedIn: 'root',
  factory: () => normalizeConvexUrl(typeof __CONVEX_URL__ === 'undefined' ? null : __CONVEX_URL__),
});
