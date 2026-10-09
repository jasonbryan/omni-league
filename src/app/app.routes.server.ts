import { RenderMode, ServerRoute } from '@angular/ssr';

// Route policy: ADR 0006 and docs/conventions/angular.md "Rendering".
// `app/**` stays inactive until a client route exists under `app/` (the first `/app` feature);
// until then `/app/...` matches the client `**` route and gets the not-found page from `**`.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender }, // placeholder home, no Convex data
  {
    path: 'app/**',
    renderMode: RenderMode.Client, // signed-in app
    // ADR 0010 item 4: the shell is the same for every user and changes only with a deploy,
    // which purges Netlify's cache, so the CDN may keep it for a day.
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' },
  },
  {
    path: '**',
    renderMode: RenderMode.Server, // public pages and not-found (the view sets status 404, #23)
    // ADR 0006 "Cacheable": the not-found render is anonymous and the same for every visitor.
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  },
];
