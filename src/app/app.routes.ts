import { Routes } from '@angular/router';

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
  // Last: every URL no other route matches, including `/app/...` until the signed-in app has
  // client routes (#23). The `**` server route renders it with status 404.
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
