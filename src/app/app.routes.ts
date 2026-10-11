import { Routes } from '@angular/router';
import { redirectSignedIn, requireSignedIn } from './core/auth/guards';

export const routes: Routes = [
  {
    path: '',
    // The not-found view sets its own title, so a navigation home sets this one back.
    title: 'Omni League',
    loadComponent: () => import('./placeholder/placeholder').then((m) => m.Placeholder),
  },
  {
    // The public organization page (#60), a Server route (app.routes.server.ts).
    path: 'organizations/:orgSlug',
    loadComponent: () =>
      import('./organizations/organization-page').then((m) => m.OrganizationPage),
  },
  {
    // Sign-up (#62), a Client route. A signed-in visitor goes on to `returnTo`, else /app.
    path: 'sign-up',
    title: 'Create an account | Omni League',
    canActivate: [redirectSignedIn],
    loadComponent: () => import('./sign-up/sign-up-page').then((m) => m.SignUpPage),
  },
  {
    // Sign-in (#63), a Client route. A signed-in visitor goes on to `returnTo`, else /app.
    path: 'sign-in',
    title: 'Sign in | Omni League',
    canActivate: [redirectSignedIn],
    loadComponent: () => import('./sign-in/sign-in-page').then((m) => m.SignInPage),
  },
  {
    // The signed-in app (#62): Client routes only (app.routes.server.ts), so the guards never run
    // on the server. Unknown /app paths get the not-found view in the client shell.
    path: 'app',
    children: [
      {
        path: '',
        title: 'Your account | Omni League',
        canActivate: [requireSignedIn],
        loadComponent: () => import('./account/account-page').then((m) => m.AccountPage),
      },
      {
        // Create an organization (#64). Ahead of the admin area's `organizations/:slug` (#65), and
        // the reserved slug `new` keeps the two apart.
        path: 'organizations/new',
        title: 'Create an organization | Omni League',
        canActivate: [requireSignedIn],
        loadComponent: () =>
          import('./organizations/create-organization-page').then((m) => m.CreateOrganizationPage),
      },
      {
        // The organization admin area (#65). The parent asks organizations.getAdminContext first
        // and renders a child only for an org admin; the no-access and not-found views take the
        // place of every child. Overview is the area's own path. #67 adds Staff.
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
        ],
      },
      {
        path: '**',
        loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
      },
    ],
  },
  // Last: every URL no other route matches. The `**` server route renders it with status 404.
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
