import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * ADR 0010 item 4 (amended, PR #102): a Client route's shell is the same for every visitor, but it
 * names this build's content-hashed bundles, and a deploy deletes the previous build's. An edge copy
 * stored while a deploy goes live outlives Netlify's purge, so a shared cache that kept the shell
 * would serve a blank page until it expired. No shared cache keeps it: every load asks the edge
 * function, as the cost estimate (ADR 0010 item 7) already assumes, and installed clients get the
 * shell from the service worker (ADR 0013) without a request.
 */
const CLIENT_SHELL_CACHE = 'public, max-age=0, must-revalidate';

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
    // Sign-in (#63): the same, so no auth code runs on the server.
    path: 'sign-in',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    // Accepting a staff invite (#70): the link's token is a bearer secret, so the page is rendered
    // in the browser only, and `Referrer-Policy: no-referrer` keeps even the page's own URL out of
    // any Referer. The token is in the fragment, which no request carries, and the page moves it
    // to sessionStorage and out of the URL before anything else.
    path: 'invites/accept',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE, 'Referrer-Policy': 'no-referrer' },
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
    // The sport view (#114): the same, with `Netlify-Vary: query` from the handler
    // (src/server-cache.ts), so each `?page=N` is stored on its own. Its HTML holds only the page
    // number the query result gives, never the request's query string.
    path: 'organizations/:orgSlug/sports/:sport',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
  {
    // The public league page (#127): the same, with `Netlify-Vary: query` from the handler
    // (src/server-cache.ts), so each `?page=N` is stored on its own. Its HTML holds only the page
    // number the query result gives, never the request's query string.
    path: 'organizations/:orgSlug/leagues/:leagueSlug',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
  {
    // The public season page (#128): the same. Its HTML holds nothing of the query string.
    path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
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
