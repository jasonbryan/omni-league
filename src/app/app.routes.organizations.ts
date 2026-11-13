import { Routes } from '@angular/router';

export const organizationRoutes: Routes = [
  {
    // A bare `/organizations` would match the parent alone and render nothing, where an unknown path gets the not-found page with status 404.
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./not-found/not-found-page').then((m) => m.NotFoundPage),
  },
  {
    path: ':orgSlug',
    loadComponent: () =>
      import('./organizations/organization-page').then((m) => m.OrganizationPage),
  },
  {
    path: ':orgSlug/sports/:sport',
    loadComponent: () =>
      import('./organizations/organization-page').then((m) => m.OrganizationPage),
  },
  {
    path: ':orgSlug/leagues/:leagueSlug',
    loadComponent: () =>
      import('./organizations/public-league/public-league-page').then((m) => m.PublicLeaguePage),
  },
  {
    path: ':orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    loadComponent: () =>
      import('./organizations/public-season/public-season-page').then((m) => m.PublicSeasonPage),
  },
  {
    path: ':orgSlug/tournaments/:tournamentSlug',
    loadComponent: () =>
      import('./organizations/public-tournament/public-tournament-page').then(
        (m) => m.PublicTournamentPage,
      ),
  },
];
