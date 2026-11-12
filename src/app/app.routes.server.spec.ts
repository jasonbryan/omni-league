import type { Route, Routes } from '@angular/router';
import { RenderMode } from '@angular/ssr';
import { AccountPage } from './account/account-page';
import { NotificationsPage } from './notifications/notifications-page';
import { AccountSettingsPage } from './account/account-settings-page';
import { FindPage } from './find/find-page';
import { AcceptInvitePage } from './invites/accept-invite-page';
import { captureInviteToken, captureTeamInviteToken } from './invites/capture-invite-token';
import { routes } from './app.routes';
import { redirectSignedIn, requireSignedIn } from './core/auth/guards';
import { serverRoutes } from './app.routes.server';
import { AppNotFoundPage } from './not-found/app-not-found-page';
import { JoinTeamPage } from './teams/join-team-page';
import { RegisterFreeAgentPage } from './teams/register-free-agent-page';
import { RegisterTeamPage } from './teams/register-team-page';
import { TeamPage } from './teams/team-page';
import { NotFoundPage } from './not-found/not-found-page';
import { AdminArea } from './organizations/admin/admin-area';
import { AdminLeagues } from './organizations/admin/admin-leagues';
import { AdminTournaments } from './organizations/admin/admin-tournaments';
import { AdminStaff } from './organizations/admin/admin-staff';
import { AdminDetails } from './organizations/admin/admin-details';
import { SeasonPage } from './organizations/season-management/season-page';
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

async function lazyChildren(route: Route | undefined): Promise<Routes> {
  return (await route?.loadChildren?.()) as Routes;
}

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
  it("server routes are exactly '' Prerender, sign-up, sign-in, invites/accept, teams/join, app, app/** Client, leagues Server, organizations/:orgSlug Server, organizations/:orgSlug/sports/:sport Server, organizations/:orgSlug/leagues/:leagueSlug Server, organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug Server, ** Server, in that order", () => {
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
        path: 'teams/join',
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
    ).toEqual(['sign-up', 'sign-in', 'invites/accept', 'teams/join', 'app', 'app/**']);
  });

  it('the client router has \'\' (the placeholder, titled "Omni League"), the organization page, the sport view, the league page, the season page, sign-up, sign-in, invites/accept, teams/join, app, and then **', async () => {
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
      'teams/join',
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

  for (const [path, page, title, guard] of [
    ['invites/accept', AcceptInvitePage, 'Staff invite | Omni League', captureInviteToken],
    ['teams/join', JoinTeamPage, 'Team invite | Omni League', captureTeamInviteToken],
  ] as const) {
    it(`${path} lazy-loads one titled child behind the guard that takes the token out of the URL, rerun on every navigation`, async () => {
      const route = routes.find((r) => r.path === path);
      expect(route?.component).toBeUndefined();
      expect(route?.loadComponent).toBeUndefined();
      expect(route?.title).toBeUndefined();
      expect(route?.canActivate).toBeUndefined();
      expect(route?.runGuardsAndResolvers).toBeUndefined();
      const [child, ...rest] = await lazyChildren(route);
      expect(rest).toEqual([]);
      expect(child?.path).toBe('');
      expect(child?.title).toBe(title);
      expect(child?.canActivate).toEqual([guard]);
      expect(child?.runGuardsAndResolvers).toBe('always');
      expect(await child?.loadComponent?.()).toBe(page);
    });
  }

  it('each invite page is a Client route whose response sends no referrer', () => {
    for (const path of ['invites/accept', 'teams/join']) {
      const invite = serverRoutes.find((r) => r.path === path);
      expect(invite?.renderMode, path).toBe(RenderMode.Client);
      const headers = new Headers(invite?.renderMode === RenderMode.Client ? invite.headers : {});
      expect(headers.get('Referrer-Policy'), path).toBe('no-referrer');
    }
  });

  it('app lazy-loads the guarded home page, the guarded account settings page, the guarded notifications page, the guarded create-organization page, the guarded league management page, the guarded season management page, the guarded admin area, the unguarded register routes, the guarded team page, and its own not-found route', async () => {
    const app = routes.find((r) => r.path === 'app');
    expect(app?.component).toBeUndefined();
    expect(app?.loadComponent).toBeUndefined();
    expect(app?.canActivate).toBeUndefined();
    expect(app?.children).toBeUndefined();
    const [
      account,
      settings,
      notifications,
      create,
      league,
      season,
      admin,
      register,
      registerFreeAgent,
      team,
      notFound,
      ...rest
    ] = await lazyChildren(app);
    expect(rest).toEqual([]);
    expect(settings?.path).toBe('account');
    expect(settings?.title).toBe('Account settings | Omni League');
    expect(settings?.canActivate).toEqual([requireSignedIn]);
    expect(await settings?.loadComponent?.()).toBe(AccountSettingsPage);
    expect(notifications?.path).toBe('notifications');
    expect(notifications?.title).toBe('Notifications | Omni League');
    expect(notifications?.canActivate).toEqual([requireSignedIn]);
    expect(await notifications?.loadComponent?.()).toBe(NotificationsPage);
    expect(create?.path).toBe('organizations/new');
    expect(create?.title).toBe('Create an organization | Omni League');
    expect(create?.canActivate).toEqual([requireSignedIn]);
    expect(await create?.loadComponent?.()).toBe(CreateOrganizationPage);
    expect(league?.path).toBe('organizations/:orgSlug/leagues/:leagueSlug');
    expect(league?.canActivate).toEqual([requireSignedIn]);
    expect(await league?.loadComponent?.()).toBe(LeaguePage);
    expect(season?.path).toBe('organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug');
    expect(season?.canActivate).toEqual([requireSignedIn]);
    expect(await season?.loadComponent?.()).toBe(SeasonPage);
    expect(admin?.path).toBe('organizations/:slug');
    expect(admin?.canActivate).toEqual([requireSignedIn]);
    expect(await admin?.loadComponent?.()).toBe(AdminArea);
    expect(admin?.children?.map((r) => r.path)).toEqual([
      '',
      'locations',
      'leagues',
      'tournaments',
      'staff',
      'details',
    ]);
    expect(admin?.children?.[0]?.pathMatch).toBe('full');
    expect(await admin?.children?.[0]?.loadComponent?.()).toBe(AdminOverview);
    expect(await admin?.children?.[1]?.loadComponent?.()).toBe(AdminLocations);
    expect(await admin?.children?.[2]?.loadComponent?.()).toBe(AdminLeagues);
    expect(await admin?.children?.[3]?.loadComponent?.()).toBe(AdminTournaments);
    expect(await admin?.children?.[4]?.loadComponent?.()).toBe(AdminStaff);
    expect(await admin?.children?.[5]?.loadComponent?.()).toBe(AdminDetails);
    expect(account?.path).toBe('');
    expect(account?.title).toBe('Home | Omni League');
    expect(account?.canActivate).toEqual([requireSignedIn]);
    expect(await account?.loadComponent?.()).toBe(AccountPage);
    // The page itself sends a signed-out visitor to sign in, after it has shown an unknown season as not found.
    expect(register?.path).toBe('register/:orgSlug/:leagueSlug/:seasonSlug/team');
    expect(register?.title).toBe('Register a team | Omni League');
    expect(register?.canActivate).toBeUndefined();
    expect(await register?.loadComponent?.()).toBe(RegisterTeamPage);
    expect(registerFreeAgent?.path).toBe('register/:orgSlug/:leagueSlug/:seasonSlug/free-agent');
    expect(registerFreeAgent?.title).toBe('Register as a free agent | Omni League');
    expect(registerFreeAgent?.canActivate).toBeUndefined();
    expect(await registerFreeAgent?.loadComponent?.()).toBe(RegisterFreeAgentPage);
    expect(team?.path).toBe('teams/:teamId');
    expect(team?.title).toBe('Team | Omni League');
    expect(team?.canActivate).toEqual([requireSignedIn]);
    expect(await team?.loadComponent?.()).toBe(TeamPage);
    expect(notFound?.path).toBe('**');
    expect(notFound?.canActivate).toBeUndefined();
    expect(await notFound?.loadComponent?.()).toBe(AppNotFoundPage);
  });
});
