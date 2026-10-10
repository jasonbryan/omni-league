import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * ADR 0010 item 4: a Client route's shell is the same for every visitor and changes only with a
 * deploy, which purges Netlify's cache, so the CDN may keep it for a day. It holds no per-visitor
 * data and no query string (`Netlify-Vary: query` keys each query string apart anyway).
 */
const CLIENT_SHELL_CACHE = 'public, max-age=0, s-maxage=86400';

// Route policy: ADR 0006 and docs/conventions/angular.md "Rendering".
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender }, // placeholder home, no Convex data
  {
    // Sign-up (#62): rendered in the browser only, so no auth code runs on the server (ADR 0008).
    path: 'sign-up',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    path: 'app',
    renderMode: RenderMode.Client, // signed-in app (#62): the guard runs in the browser only
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    path: 'app/**',
    renderMode: RenderMode.Client, // signed-in app, including its not-found view
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    // ADR 0006: a public page that reads Convex data, anonymous and cacheable. A failed query
    // replaces the Cache-Control with no-store (src/app/core/server-error-status.ts, #60).
    path: 'organizations/:orgSlug',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
  {
    path: '**',
    renderMode: RenderMode.Server, // public pages and not-found (the view sets status 404, #23)
    // ADR 0006 "Cacheable": the not-found render is anonymous and the same for every visitor.
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
];
