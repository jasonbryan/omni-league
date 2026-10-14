import { RenderMode, ServerRoute } from '@angular/ssr';

/** A Client route's shell names this build's content-hashed bundles, and a deploy deletes the previous build's. A shared cache that kept the shell would serve a blank page until it expired, so none does. */
const CLIENT_SHELL_CACHE = 'public, max-age=0, must-revalidate';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  {
    // Rendered in the browser only, so no auth code runs on the server.
    path: 'sign-up',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    path: 'sign-in',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    // The link's token is a bearer secret: rendered in the browser only, with `Referrer-Policy: no-referrer` so no Referer carries the page's URL.
    // The token is in the fragment, which no request carries, and the page moves it to sessionStorage and out of the URL first.
    path: 'invites/accept',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE, 'Referrer-Policy': 'no-referrer' },
  },
  {
    path: 'app',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    path: 'app/**',
    renderMode: RenderMode.Client,
    headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
  },
  {
    // A failed query replaces the Cache-Control with no-store (src/app/core/server-error-status.ts).
    path: 'organizations/:orgSlug',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
  {
    // `Netlify-Vary: query` from the handler (src/server-cache.ts) stores each `?page=N` on its own. The HTML holds only the page number
    // from the query result, never the request's query string.
    path: 'organizations/:orgSlug/leagues/:leagueSlug',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
  {
    // The HTML holds nothing of the query string.
    path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
];
