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
    title: 'League | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./organizations/league/league-page').then((m) => m.LeaguePage),
  },
  {
    path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    title: 'Season | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () =>
      import('./organizations/season-management/season-page').then((m) => m.SeasonPage),
  },
  {
    // No guard: an unknown tournament shows the not-found view before any sign-in, and the page sends a signed-out visitor to sign in. Ahead of the admin area, whose `organizations/:slug` is a shorter prefix of the same URL space.
    path: 'organizations/:orgSlug/tournaments/:tournamentSlug/register',
    title: 'Register a team | Omni League',
    loadComponent: () =>
      import('./teams/register-tournament-team-page').then((m) => m.RegisterTournamentTeamPage),
  },
  {
    // Outside the admin area, which is for org admins only: an organizer assigned to the tournament opens it too.
    path: 'organizations/:orgSlug/tournaments/:tournamentSlug',
    title: 'Tournament | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () =>
      import('./organizations/admin/tournament-page').then((m) => m.TournamentPage),
  },
  {
    // No guard: an unknown camp shows the not-found view before any sign-in, and the page sends a signed-out visitor to sign in. Ahead of the admin area, whose `organizations/:slug` is a shorter prefix of the same URL space.
    path: 'organizations/:orgSlug/camps/:campSlug/register',
    title: 'Register for a camp session | Omni League',
    loadComponent: () =>
      import('./organizations/register-camp/register-camp-page').then((m) => m.RegisterCampPage),
  },
  {
    // Outside the admin area, which is for org admins only: an organizer assigned to the training program opens it too.
    path: 'organizations/:orgSlug/training/:trainingSlug',
    title: 'Training program | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./organizations/admin/training-page').then((m) => m.TrainingPage),
  },
  {
    // Outside the admin area, which is for org admins only: an organizer assigned to the camp opens it too.
    path: 'organizations/:orgSlug/camps/:campSlug',
    title: 'Camp | Omni League',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./organizations/admin/camp-page').then((m) => m.CampPage),
  },
  {
    path: 'organizations/:slug',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./organizations/admin/admin-area').then((m) => m.AdminArea),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Overview | Omni League',
        loadComponent: () =>
          import('./organizations/admin/admin-overview').then((m) => m.AdminOverview),
      },
      {
        path: 'locations',
        title: 'Locations | Omni League',
        loadComponent: () =>
          import('./organizations/admin/admin-locations').then((m) => m.AdminLocations),
      },
      {
        path: 'leagues',
        title: 'Leagues | Omni League',
        loadComponent: () =>
          import('./organizations/admin/admin-leagues').then((m) => m.AdminLeagues),
      },
      {
        path: 'tournaments',
        title: 'Tournaments | Omni League',
        loadComponent: () =>
          import('./organizations/admin/admin-tournaments').then((m) => m.AdminTournaments),
      },
      {
        path: 'camps',
        title: 'Camps | Omni League',
        loadComponent: () => import('./organizations/admin/admin-camps').then((m) => m.AdminCamps),
      },
      {
        path: 'training',
        title: 'Training | Omni League',
        loadComponent: () =>
          import('./organizations/admin/admin-training').then((m) => m.AdminTraining),
      },
      {
        path: 'staff',
        title: 'Staff | Omni League',
        loadComponent: () => import('./organizations/admin/admin-staff').then((m) => m.AdminStaff),
      },
      {
        path: 'details',
        title: 'Details | Omni League',
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
    title: 'Page not found | Omni League',
    loadComponent: () => import('./not-found/app-not-found-page').then((m) => m.AppNotFoundPage),
  },
];
