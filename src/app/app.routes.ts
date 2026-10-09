import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // The not-found view sets its own title, so a navigation home sets this one back.
    title: 'Omni League',
    loadComponent: () => import('./placeholder/placeholder').then((m) => m.Placeholder),
  },
  // Last: every URL no other route matches, including `/app/...` until the signed-in app has
  // client routes (#23). The `**` server route renders it with status 404.
  {
    path: '**',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
