import { RenderMode } from '@angular/ssr';
import { routes } from './app.routes';
import { serverRoutes } from './app.routes.server';
import { NotFoundPage } from './not-found/not-found-page';
import { OrganizationPage } from './organizations/organization-page';
import { Placeholder } from './placeholder/placeholder';

// ADR 0006's public-page header: the not-found render is anonymous and the same for every visitor.
const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

// Route tables fixed by ADR 0006 "Rendering specification" for the scaffold (#10), with the
// `app/**` shell header from ADR 0010 item 4 (#37), the `**` not-found header (#23), and the public
// organization page (#60).
describe('Route tables', () => {
  it("server routes are exactly '' Prerender, app/** Client, organizations/:orgSlug Server, ** Server, in that order", () => {
    expect(serverRoutes).toEqual([
      { path: '', renderMode: RenderMode.Prerender },
      {
        path: 'app/**',
        renderMode: RenderMode.Client,
        // ADR 0010 item 4: the shell is identical for every user and changes only with a deploy.
        headers: { 'Cache-Control': 'public, max-age=0, s-maxage=86400' },
      },
      {
        // ADR 0006: a public page that reads Convex data, anonymous and cacheable.
        path: 'organizations/:orgSlug',
        renderMode: RenderMode.Server,
        headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
      },
      {
        path: '**',
        renderMode: RenderMode.Server,
        headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
      },
    ]);
  });

  it('the client router has \'\' (the placeholder, titled "Omni League"), the organization page, and then **', async () => {
    expect(routes.map((route) => route.path)).toEqual(['', 'organizations/:orgSlug', '**']);
    const [home] = routes;
    expect(home.component).toBeUndefined();
    expect(await home.loadComponent?.()).toBe(Placeholder);
    // The not-found view sets its own title, so a later navigation home must set it back.
    expect(home.title).toBe('Omni League');
  });

  it('organizations/:orgSlug lazy-loads the organization page', async () => {
    const route = routes.find((r) => r.path === 'organizations/:orgSlug');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(OrganizationPage);
  });

  it('the last client route is **, which lazy-loads the not-found page', async () => {
    const last = routes.at(-1);
    expect(last?.path).toBe('**');
    expect(last?.component).toBeUndefined();
    expect(await last?.loadComponent?.()).toBe(NotFoundPage);
  });
});
