import { Routes } from '@angular/router';
import { redirectSignedIn } from './core/auth/guards';
import { redirectLeagues } from './find/leagues-redirect';

export const routes: Routes = [
  {
    path: '',
    // The not-found view sets its own title, so a navigation home sets this one back.
    title: 'Omni League',
    loadComponent: () => import('./placeholder/placeholder').then((m) => m.Placeholder),
  },
  {
    // Redirects in the browser for an in-app link or the service worker's shell, and in the server render, where the engine sends it as a 301 (`app.routes.server.ts`).
    path: 'leagues',
    canActivate: [redirectLeagues],
    children: [],
  },
  {
    path: 'programs',
    loadComponent: () => import('./find/find-page').then((m) => m.FindPage),
  },
  {
    path: 'organizations',
    loadChildren: () => import('./app.routes.organizations').then((m) => m.organizationRoutes),
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
