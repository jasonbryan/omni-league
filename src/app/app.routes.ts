import { Routes } from '@angular/router';
import { redirectSignedIn } from './core/auth/guards';

export const routes: Routes = [
  {
    path: '',
    // The not-found view sets its own title, so a navigation home sets this one back.
    title: 'Omni League',
    loadComponent: () => import('./placeholder/placeholder').then((m) => m.Placeholder),
  },
  {
    path: 'leagues',
    loadComponent: () => import('./find/find-page').then((m) => m.FindPage),
  },
  {
    path: 'organizations/:orgSlug',
    loadComponent: () =>
      import('./organizations/organization-page').then((m) => m.OrganizationPage),
  },
  {
    path: 'organizations/:orgSlug/sports/:sport',
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
    path: 'invites/accept',
    loadChildren: () => import('./app.routes.invites').then((m) => m.acceptInviteRoutes),
  },
  {
    path: 'teams/join',
    loadChildren: () => import('./app.routes.invites').then((m) => m.joinTeamRoutes),
  },
  {
    // Client routes only, so the guards never run on the server.
    path: 'app',
    loadChildren: () => import('./app.routes.app').then((m) => m.appRoutes),
  },
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
