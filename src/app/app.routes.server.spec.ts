import { RenderMode } from '@angular/ssr';
import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';
import { Placeholder } from './placeholder/placeholder';

// Route tables fixed by ADR 0006 "Rendering specification" for the scaffold (#10).
describe('Route tables', () => {
  it("server routes are exactly '' Prerender, app/** Client, ** Server, in that order", () => {
    expect(serverRoutes).toEqual([
      { path: '', renderMode: RenderMode.Prerender },
      { path: 'app/**', renderMode: RenderMode.Client },
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
