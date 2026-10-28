import { RenderMode } from '@angular/ssr';
import { AccountPage } from './account/account-page';
import { FindPage } from './find/find-page';
import { AcceptInvitePage } from './invites/accept-invite-page';
import { captureInviteToken } from './invites/capture-invite-token';
import { routes } from './app.routes';
import { redirectSignedIn, requireSignedIn } from './core/auth/guards';
import { serverRoutes } from './app.routes.server';
import { AppNotFoundPage } from './not-found/app-not-found-page';
import { NotFoundPage } from './not-found/not-found-page';
import { AdminArea } from './organizations/admin/admin-area';
import { AdminLeagues } from './organizations/admin/admin-leagues';
import { AdminStaff } from './organizations/admin/admin-staff';
import { AdminDetails } from './organizations/admin/admin-details';
import { LeaguePage } from './organizations/league/league-page';
import { AdminLocations } from './organizations/admin/admin-locations';
import { AdminOverview } from './organizations/admin/admin-overview';
import { CreateOrganizationPage } from './organizations/create-organization-page';
import { OrganizationPage } from './organizations/organization-page';
import { PublicLeaguePage } from './organizations/public-league/public-league-page';
import { PublicSeasonPage } from './organizations/public-season/public-season-page';
import { Placeholder } from './placeholder/placeholder';
import { SignInPage } from './sign-in/sign-in-page';
import { SignUpPage } from './sign-up/sign-up-page';

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const CLIENT_SHELL_CACHE = 'public, max-age=0, must-revalidate';

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

describe('Route tables', () => {
  it("server routes are exactly '' Prerender, sign-up, sign-in, invites/accept, app, app/** Client, leagues Server, organizations/:orgSlug Server, organizations/:orgSlug/sports/:sport Server, organizations/:orgSlug/leagues/:leagueSlug Server, organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug Server, ** Server, in that order", () => {
    expect(serverRoutes).toEqual([
      { path: '', renderMode: RenderMode.Prerender },
      {
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
        path: 'leagues',
        renderMode: RenderMode.Server,
        headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
      },
      {
        path: 'organizations/:orgSlug',
        renderMode: RenderMode.Server,
        headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
      },
      {
        path: 'organizations/:orgSlug/sports/:sport',
        renderMode: RenderMode.Server,
        headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
      },
      {
        path: 'organizations/:orgSlug/leagues/:leagueSlug',
        renderMode: RenderMode.Server,
        headers: { 'Cache-Control': PUBLIC_PAGE_CACHE },
      },
      {
        path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
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
    ).toEqual(['sign-up', 'sign-in', 'invites/accept', 'app', 'app/**']);
  });

  it('the client router has \'\' (the placeholder, titled "Omni League"), the organization page, the sport view, the league page, the season page, sign-up, sign-in, invites/accept, app, and then **', async () => {
    expect(routes.map((route) => route.path)).toEqual([
      '',
      'leagues',
      'organizations/:orgSlug',
      'organizations/:orgSlug/sports/:sport',
      'organizations/:orgSlug/leagues/:leagueSlug',
      'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
      'sign-up',
      'sign-in',
      'invites/accept',
      'app',
      '**',
    ]);
    const [home] = routes;
    expect(home.component).toBeUndefined();
    expect(await home.loadComponent?.()).toBe(Placeholder);
    expect(home.title).toBe('Omni League');
  });

  it('leagues lazy-loads the find page', async () => {
    const route = routes.find((r) => r.path === 'leagues');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(FindPage);
  });

  it('organizations/:orgSlug lazy-loads the organization page', async () => {
    const route = routes.find((r) => r.path === 'organizations/:orgSlug');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(OrganizationPage);
  });

  it('organizations/:orgSlug/sports/:sport lazy-loads the organization page, which filters to the sport', async () => {
    const route = routes.find((r) => r.path === 'organizations/:orgSlug/sports/:sport');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(OrganizationPage);
  });

  it('organizations/:orgSlug/leagues/:leagueSlug lazy-loads the public league page', async () => {
    const route = routes.find((r) => r.path === 'organizations/:orgSlug/leagues/:leagueSlug');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(PublicLeaguePage);
  });

  it('organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug lazy-loads the public season page', async () => {
    const route = routes.find(
      (r) => r.path === 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    );
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(PublicSeasonPage);
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

  it('invites/accept lazy-loads the invite page, behind the guard that takes the token out of the URL', async () => {
    const route = routes.find((r) => r.path === 'invites/accept');
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(AcceptInvitePage);
    expect(route?.title).toBe('Staff invite | Omni League');
    expect(route?.canActivate).toEqual([captureInviteToken]);
  });

  it("the invite page's response sends no referrer", () => {
    const invite = serverRoutes.find((r) => r.path === 'invites/accept');
    const headers = new Headers(invite?.renderMode === RenderMode.Client ? invite.headers : {});
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('app has the guarded account page, the guarded create-organization page, the guarded league management page, the guarded admin area, and its own not-found route', async () => {
    const app = routes.find((r) => r.path === 'app');
    expect(app?.component).toBeUndefined();
    expect(app?.loadComponent).toBeUndefined();
    expect(app?.canActivate).toBeUndefined();
    const [account, create, league, admin, notFound, ...rest] = app?.children ?? [];
    expect(rest).toEqual([]);
    expect(create?.path).toBe('organizations/new');
    expect(create?.title).toBe('Create an organization | Omni League');
    expect(create?.canActivate).toEqual([requireSignedIn]);
    expect(await create?.loadComponent?.()).toBe(CreateOrganizationPage);
    expect(league?.path).toBe('organizations/:orgSlug/leagues/:leagueSlug');
    expect(league?.canActivate).toEqual([requireSignedIn]);
    expect(await league?.loadComponent?.()).toBe(LeaguePage);
    expect(admin?.path).toBe('organizations/:slug');
    expect(admin?.canActivate).toEqual([requireSignedIn]);
    expect(await admin?.loadComponent?.()).toBe(AdminArea);
    expect(admin?.children?.map((r) => r.path)).toEqual([
      '',
      'locations',
      'leagues',
      'staff',
      'details',
    ]);
    expect(admin?.children?.[0]?.pathMatch).toBe('full');
    expect(await admin?.children?.[0]?.loadComponent?.()).toBe(AdminOverview);
    expect(await admin?.children?.[1]?.loadComponent?.()).toBe(AdminLocations);
    expect(await admin?.children?.[2]?.loadComponent?.()).toBe(AdminLeagues);
    expect(await admin?.children?.[3]?.loadComponent?.()).toBe(AdminStaff);
    expect(await admin?.children?.[4]?.loadComponent?.()).toBe(AdminDetails);
    expect(account?.path).toBe('');
    expect(account?.title).toBe('Your account | Omni League');
    expect(account?.canActivate).toEqual([requireSignedIn]);
    expect(await account?.loadComponent?.()).toBe(AccountPage);
    expect(notFound?.path).toBe('**');
    expect(notFound?.canActivate).toBeUndefined();
    expect(await notFound?.loadComponent?.()).toBe(AppNotFoundPage);
  });
});
