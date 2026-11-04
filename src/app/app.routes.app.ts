import { Routes } from '@angular/router';
import { requireSignedIn } from './core/auth/guards';

export const appRoutes: Routes = [
  {
    path: '',
    title: 'Home | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./account/account-page').then((m) => m.AccountPage),
  },
  {
    path: 'account',
    title: 'Account settings | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () =>
      import('./account/account-settings-page').then((m) => m.AccountSettingsPage),
  },
  {
    path: 'notifications',
    title: 'Notifications | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () =>
      import('./notifications/notifications-page').then((m) => m.NotificationsPage),
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
    path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    canActivate: [requireSignedIn],
    loadComponent: () =>
      import('./organizations/season-management/season-page').then((m) => m.SeasonPage),
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
        loadComponent: () => import('./organizations/admin/admin-staff').then((m) => m.AdminStaff),
      },
      {
        path: 'details',
        loadComponent: () =>
          import('./organizations/admin/admin-details').then((m) => m.AdminDetails),
      },
    ],
  },
  {
    // No guard: an unknown season shows the not-found view before any sign-in, and the page sends a signed-out visitor to sign in.
    path: 'register/:orgSlug/:leagueSlug/:seasonSlug/team',
    title: 'Register a team | Omni League',
    loadComponent: () => import('./teams/register-team-page').then((m) => m.RegisterTeamPage),
  },
  {
    // No guard: an unknown season shows the not-found view before any sign-in, and the page sends a signed-out visitor to sign in.
    path: 'register/:orgSlug/:leagueSlug/:seasonSlug/free-agent',
    title: 'Register as a free agent | Omni League',
    loadComponent: () =>
      import('./teams/register-free-agent-page').then((m) => m.RegisterFreeAgentPage),
  },
  {
    path: 'teams/:teamId',
    title: 'Team | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./teams/team-page').then((m) => m.TeamPage),
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/app-not-found-page').then((m) => m.AppNotFoundPage),
  },
];
