import { RenderMode } from '@angular/ssr';
import { AccountPage } from './account/account-page';
import { routes } from './app.routes';
import { redirectSignedIn, requireSignedIn } from './core/auth/guards';
import { serverRoutes } from './app.routes.server';
import { NotFoundPage } from './not-found/not-found-page';
import { AdminArea } from './organizations/admin/admin-area';
import { AdminLocations } from './organizations/admin/admin-locations';
import { AdminOverview } from './organizations/admin/admin-overview';
import { CreateOrganizationPage } from './organizations/create-organization-page';
import { OrganizationPage } from './organizations/organization-page';
import { Placeholder } from './placeholder/placeholder';
import { SignInPage } from './sign-in/sign-in-page';
import { SignUpPage } from './sign-up/sign-up-page';

// ADR 0006's public-page header: the not-found render is anonymous and the same for every visitor.
const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
// ADR 0010 item 4 (amended, PR #102): a Client route's shell names this build's hashed bundles, so no
// shared cache keeps it past a deploy.
const CLIENT_SHELL_CACHE = 'public, max-age=0, must-revalidate';

/** The directives of a `Cache-Control` value, by lower-case name (`true` when it has no value). */
function directives(value: string): Map<string, string | true> {
  return new Map(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part): [string, string | true] => {
        const [name, ...rest] = part.split('=');
        return [name.trim().toLowerCase(), rest.length ? rest.join('=').trim() : true];
      }),
  );
}

// Route tables fixed by ADR 0006 "Rendering specification" for the scaffold (#10), with the
// `app/**` shell header from ADR 0010 item 4 (#37), the `**` not-found header (#23), the public
// organization page (#60), and sign-up and the signed-in app (#62).
describe('Route tables', () => {
  it("server routes are exactly '' Prerender, sign-up, sign-in, app, app/** Client, organizations/:orgSlug Server, ** Server, in that order", () => {
    expect(serverRoutes).toEqual([
      { path: '', renderMode: RenderMode.Prerender },
      // #62: no auth code runs on the server, so these render in the browser only.
      {
        path: 'sign-up',
        renderMode: RenderMode.Client,
        headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
      },
      {
        // #63: the same, for sign-in.
        path: 'sign-in',
        renderMode: RenderMode.Client,
        headers: { 'Cache-Control': CLIENT_SHELL_CACHE },
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

  // PR #102 tester round 4: an edge copy of a Client shell stored as a deploy went live kept naming
  // the previous build's deleted `main-*.js` (a blank page) for as long as its `s-maxage`. Netlify
  // deletes the old build's hashed files at once, so no Client shell may live in a shared cache.
  it.each(
    serverRoutes
      .filter((route) => route.renderMode === RenderMode.Client)
      .map((route) => [route.path, route] as const),
  )('Client route %s is never kept by a shared cache', (_, route) => {
    const headers = new Headers(route.renderMode === RenderMode.Client ? route.headers : {});
    // Netlify and other CDNs take their TTL from these headers ahead of Cache-Control.
    expect(headers.get('CDN-Cache-Control')).toBeNull();
    expect(headers.get('Netlify-CDN-Cache-Control')).toBeNull();
    const cache = directives(headers.get('Cache-Control') ?? '');
    expect(cache.get('max-age')).toBe('0');
    expect(cache.get('must-revalidate')).toBe(true);
    for (const lifetime of ['s-maxage', 'stale-while-revalidate', 'stale-if-error']) {
      expect(cache.has(lifetime), lifetime).toBe(false);
    }
  });

  it('has Client routes for the bound above to check', () => {
    expect(
      serverRoutes.filter((route) => route.renderMode === RenderMode.Client).map((r) => r.path),
    ).toEqual(['sign-up', 'sign-in', 'app', 'app/**']);
  });

  it('the client router has \'\' (the placeholder, titled "Omni League"), the organization page, sign-up, sign-in, app, and then **', async () => {
    expect(routes.map((route) => route.path)).toEqual([
      '',
      'organizations/:orgSlug',
      'sign-up',
      'sign-in',
      'app',
      '**',
    ]);
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

  it('sign-up lazy-loads the sign-up page, titled, and sends a signed-in visitor on', async () => {
    const route = routes.find((r) => r.path === 'sign-up');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(SignUpPage);
    expect(route?.title).toBe('Create an account | Omni League');
    expect(route?.canActivate).toEqual([redirectSignedIn]);
  });

  it('sign-in lazy-loads the sign-in page, titled, and sends a signed-in visitor on', async () => {
    const route = routes.find((r) => r.path === 'sign-in');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(SignInPage);
    expect(route?.title).toBe('Sign in | Omni League');
    expect(route?.canActivate).toEqual([redirectSignedIn]);
  });

  it('app has the guarded account page, the guarded create-organization page, the guarded admin area, and its own not-found route', async () => {
    const app = routes.find((r) => r.path === 'app');
    expect(app?.component).toBeUndefined();
    expect(app?.loadComponent).toBeUndefined();
    expect(app?.canActivate).toBeUndefined();
    const [account, create, admin, notFound, ...rest] = app?.children ?? [];
    expect(rest).toEqual([]);
    // #64: ahead of the not-found route, so /app/organizations/new is not a 404.
    expect(create?.path).toBe('organizations/new');
    expect(create?.title).toBe('Create an organization | Omni League');
    expect(create?.canActivate).toEqual([requireSignedIn]);
    expect(await create?.loadComponent?.()).toBe(CreateOrganizationPage);
    // #65: after organizations/new (the reserved slug `new` keeps them apart), ahead of not-found.
    // Overview is the area's own path; Locations is below it.
    expect(admin?.path).toBe('organizations/:slug');
    expect(admin?.canActivate).toEqual([requireSignedIn]);
    expect(await admin?.loadComponent?.()).toBe(AdminArea);
    expect(admin?.children?.map((r) => r.path)).toEqual(['', 'locations']);
    expect(admin?.children?.[0]?.pathMatch).toBe('full');
    expect(await admin?.children?.[0]?.loadComponent?.()).toBe(AdminOverview);
    expect(await admin?.children?.[1]?.loadComponent?.()).toBe(AdminLocations);
    expect(account?.path).toBe('');
    expect(account?.title).toBe('Your account | Omni League');
    expect(account?.canActivate).toEqual([requireSignedIn]);
    expect(await account?.loadComponent?.()).toBe(AccountPage);
    expect(notFound?.path).toBe('**');
    expect(notFound?.canActivate).toBeUndefined();
    expect(await notFound?.loadComponent?.()).toBe(NotFoundPage);
  });
});
