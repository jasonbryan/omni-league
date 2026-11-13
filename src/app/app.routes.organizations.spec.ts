import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  provideRouter,
  type Route,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { organizationRoutes } from './app.routes.organizations';
import { NotFoundPage } from './not-found/not-found-page';
import { OrganizationPage } from './organizations/organization-page';
import { PublicLeaguePage } from './organizations/public-league/public-league-page';
import { PublicSeasonPage } from './organizations/public-season/public-season-page';
import { PublicTournamentPage } from './organizations/public-tournament/public-tournament-page';

@Component({ template: 'page' })
class StubPage {}

@Component({ template: 'not found' })
class StubNotFound {}

const PAGES: { url: string; path: string; page: unknown; params: Record<string, string> }[] = [
  {
    url: '/organizations/acme',
    path: ':orgSlug',
    page: OrganizationPage,
    params: { orgSlug: 'acme' },
  },
  {
    url: '/organizations/acme/sports/soccer',
    path: ':orgSlug/sports/:sport',
    page: OrganizationPage,
    params: { orgSlug: 'acme', sport: 'soccer' },
  },
  {
    url: '/organizations/acme/leagues/summer',
    path: ':orgSlug/leagues/:leagueSlug',
    page: PublicLeaguePage,
    params: { orgSlug: 'acme', leagueSlug: 'summer' },
  },
  {
    url: '/organizations/acme/leagues/summer/seasons/2027',
    path: ':orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
    page: PublicSeasonPage,
    params: { orgSlug: 'acme', leagueSlug: 'summer', seasonSlug: '2027' },
  },
  {
    url: '/organizations/acme/tournaments/open',
    path: ':orgSlug/tournaments/:tournamentSlug',
    page: PublicTournamentPage,
    params: { orgSlug: 'acme', tournamentSlug: 'open' },
  },
];

const organizationsParent = (): Route | undefined =>
  routes.find((route) => route.path === 'organizations');

/** The app's route table with `organizations` resolved and each page swapped for a stub, so no page runs. */
function stubbedRoutes(): Routes {
  const children = organizationRoutes.map((child) => ({
    ...child,
    loadComponent: undefined,
    component: child.path === '' ? StubNotFound : StubPage,
  }));
  return [
    { ...organizationsParent(), loadChildren: undefined, children },
    { path: '**', component: StubNotFound },
  ];
}

function leafOf(snapshot: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  return snapshot.firstChild ? leafOf(snapshot.firstChild) : snapshot;
}

describe('Public organization routes', () => {
  it('the app routes have one organizations route that lazy-loads the route file, and no organizations/... path of their own', async () => {
    expect(routes.filter((route) => route.path?.startsWith('organizations'))).toHaveLength(1);
    const parent = organizationsParent();
    expect(parent?.component).toBeUndefined();
    expect(parent?.loadComponent).toBeUndefined();
    expect(parent?.children).toBeUndefined();
    expect(await parent?.loadChildren?.()).toBe(organizationRoutes);
  });

  it('the route file holds the not-found route for the bare path, then the five public paths without the organizations prefix', () => {
    expect(organizationRoutes.map((route) => route.path)).toEqual([
      '',
      ...PAGES.map((p) => p.path),
    ]);
  });

  it('the bare path lazy-loads the not-found page', async () => {
    const [bare] = organizationRoutes;
    expect(bare.pathMatch).toBe('full');
    expect(await bare.loadComponent?.()).toBe(NotFoundPage);
  });

  it.each(PAGES)('$path lazy-loads its own page', async ({ path, page }) => {
    const route = organizationRoutes.find((candidate) => candidate.path === path);
    expect(route?.component).toBeUndefined();
    expect(await route?.loadComponent?.()).toBe(page);
  });

  it.each(PAGES)('$url opens the page with its route parameters', async ({ url, path, params }) => {
    TestBed.configureTestingModule({ providers: [provideRouter(stubbedRoutes())] });
    const harness = await RouterTestingHarness.create();
    const activated = await harness.navigateByUrl(url, StubPage);
    expect(activated).toBeInstanceOf(StubPage);
    const leaf = leafOf(TestBed.inject(Router).routerState.snapshot.root);
    expect(leaf.routeConfig?.path).toBe(path);
    expect(leaf.params).toEqual(params);
  });

  it.each(['/organizations', '/organizations/acme/unknown', '/organizations/acme/sports'])(
    '%s falls through to the not-found route',
    async (url) => {
      TestBed.configureTestingModule({ providers: [provideRouter(stubbedRoutes())] });
      const harness = await RouterTestingHarness.create();
      expect(await harness.navigateByUrl(url, StubNotFound)).toBeInstanceOf(StubNotFound);
    },
  );
});
