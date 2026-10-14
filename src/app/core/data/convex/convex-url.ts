import { InjectionToken } from '@angular/core';

declare global {
  const __CONVEX_URL__: string | null;
  const __CONVEX_SITE_URL__: string | null;
}

export function normalizeConvexUrl(raw: string | null | undefined): string | null {
  return raw === undefined || raw === '' ? null : raw;
}

export const CONVEX_URL = new InjectionToken<string | null>('CONVEX_URL', {
  providedIn: 'root',
  factory: () => normalizeConvexUrl(typeof __CONVEX_URL__ === 'undefined' ? null : __CONVEX_URL__),
});
