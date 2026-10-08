import { RenderMode } from '@angular/ssr';
import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';
import { Placeholder } from './placeholder/placeholder';

// Route tables fixed by ADR 0006 "Rendering specification" for the scaffold (#10), with the
// `app/**` shell header from ADR 0010 item 4 (#37).
describe('Route tables', () => {
  it("server routes are exactly '' Prerender, app/** Client, ** Server, in that order", () => {
    expect(serverRoutes).toEqual([
      { path: '', renderMode: RenderMode.Prerender },
      {
        path: 'app/**',
        renderMode: RenderMode.Client,
        // ADR 0010 item 4: the shell is identical for every user and changes only with a deploy.
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' },
      },
      { path: '**', renderMode: RenderMode.Server },
    ]);
  });

  it("the client router has exactly one route, '', which lazy-loads the placeholder", async () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('');
    expect(routes[0].component).toBeUndefined();
    expect(await routes[0].loadComponent?.()).toBe(Placeholder);
  });
});
