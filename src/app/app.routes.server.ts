import { RenderMode, ServerRoute } from '@angular/ssr';

// Route policy: ADR 0006 and docs/conventions/angular.md "Rendering".
// `app/**` and `**` stay inactive until client routes exist under them
// (the first `/app` feature and #23); until then the server answers 404.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender }, // placeholder home, no Convex data
  {
    path: 'app/**',
    renderMode: RenderMode.Client, // signed-in app
    // ADR 0010 item 4: the shell is the same for every user and changes only with a deploy,
    // which purges Netlify's cache, so the CDN may keep it for a day.
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' },
  },
  { path: '**', renderMode: RenderMode.Server }, // public pages and not-found
];
