import { Routes } from '@angular/router';
import { redirectSignedIn, requireSignedIn } from './core/auth/guards';
import { captureInviteToken } from './invites/capture-invite-token';

export const routes: Routes = [
  {
    path: '',
    // The not-found view sets its own title, so a navigation home sets this one back.
    title: 'Omni League',
    loadComponent: () => import('./placeholder/placeholder').then((m) => m.Placeholder),
  },
  {
    path: 'organizations/:orgSlug',
    loadComponent: () =>
      import('./organizations/organization-page').then((m) => m.OrganizationPage),
  },
  {
    path: 'organizations/:orgSlug/leagues/:leagueSlug',
    loadComponent: () =>
      import('./organizations/public-league/public-league-page').then((m) => m.PublicLeaguePage),
  },
  {
    path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    loadComponent: () =>
      import('./organizations/public-season/public-season-page').then((m) => m.PublicSeasonPage),
  },
  {
    path: 'sign-up',
    title: 'Create an account | Omni League',
    canActivate: [redirectSignedIn],
    loadComponent: () => import('./sign-up/sign-up-page').then((m) => m.SignUpPage),
  },
  {
    path: 'sign-in',
    title: 'Sign in | Omni League',
    canActivate: [redirectSignedIn],
    loadComponent: () => import('./sign-in/sign-in-page').then((m) => m.SignInPage),
  },
  {
    // The link is `/invites/accept#<token>`; the guard moves the token into sessionStorage and redirects to the path alone, so no URL holds it.
    path: 'invites/accept',
    title: 'Staff invite | Omni League',
    canActivate: [captureInviteToken],
    // A link opened on the open page changes only the fragment, so the guard must run again.
    runGuardsAndResolvers: 'always',
    loadComponent: () => import('./invites/accept-invite-page').then((m) => m.AcceptInvitePage),
  },
  {
    // Client routes only, so the guards never run on the server.
    path: 'app',
    children: [
      {
        path: '',
        title: 'Your account | Omni League',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./account/account-page').then((m) => m.AccountPage),
      },
      {
        // Ahead of the admin area's `organizations/:slug`; the reserved slug `new` keeps the two apart.
        path: 'organizations/new',
        title: 'Create an organization | Omni League',
        canActivate: [requireSignedIn],
        loadComponent: () =>
          import('./organizations/create-organization-page').then((m) => m.CreateOrganizationPage),
      },
      {
        // Ahead of the admin area, whose `organizations/:slug` is a shorter prefix of the same URL space.
        path: 'organizations/:orgSlug/leagues/:leagueSlug',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./organizations/league/league-page').then((m) => m.LeaguePage),
      },
      {
        path: 'organizations/:slug',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./organizations/admin/admin-area').then((m) => m.AdminArea),
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./organizations/admin/admin-overview').then((m) => m.AdminOverview),
          },
          {
            path: 'locations',
            loadComponent: () =>
              import('./organizations/admin/admin-locations').then((m) => m.AdminLocations),
          },
          {
            path: 'leagues',
            loadComponent: () =>
              import('./organizations/admin/admin-leagues').then((m) => m.AdminLeagues),
          },
          {
            path: 'staff',
            loadComponent: () =>
              import('./organizations/admin/admin-staff').then((m) => m.AdminStaff),
          },
        ],
      },
      {
        path: '**',
        loadComponent: () =>
          import('./not-found/app-not-found-page').then((m) => m.AppNotFoundPage),
      },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
