import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { expectSkeletonBoxes } from '../ui/testing/skeleton-boxes';
import { HomeSidebar } from './home-sidebar';

interface Mine {
  name: string;
  slug: string;
  role: 'orgAdmin' | 'leagueOrganizer';
  leagues: { name: string; slug: string }[];
}

describe('HomeSidebar', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;

  interface MyTeam {
    teamId: string;
    teamName: string;
  }

  async function open(url = '/app', mine?: Mine[], teams?: MyTeam[]) {
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '**', component: HomeSidebar }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    if (mine) {
      convex.activeSubscriptions.find((s) => s.name === 'organizations:listMine')?.emit(mine);
    }
    if (teams) {
      convex.activeSubscriptions.find((s) => s.name === 'teams:listMine')?.emit(teams);
    }
    await harness.fixture.whenStable();
    return harness.fixture.nativeElement as HTMLElement;
  }

  const links = (page: HTMLElement) =>
    [...page.querySelectorAll('a')].map((a) => [a.textContent.trim(), a.getAttribute('href')]);

  it('is a navigation named "Your account", headed by Omni League linking to /', async () => {
    const page = await open('/app', []);
    const nav = page.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Your account');
    expect(links(page)[0]).toEqual(['Omni League', '/']);
  });

  it('asks organizations.listMine and teams.listMine only once Convex has accepted the token', async () => {
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '**', component: HomeSidebar }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/app');
    expect(convex.subscriptions).toEqual([]);
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    expect(convex.activeSubscriptions.map((s) => s.name).sort()).toEqual([
      'organizations:listMine',
      'teams:listMine',
    ]);
  });

  it('marks Home as the current page on /app only', async () => {
    const page = await open('/app', []);
    const home = page.querySelector('a[href="/app"]');
    expect(home?.getAttribute('aria-current')).toBe('page');
    expect(page.querySelectorAll('[aria-current]')).toHaveLength(1);
    TestBed.resetTestingModule();

    const other = await open('/app/organizations/new', []);
    expect(other.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('marks no item as current on /app/account', async () => {
    const page = await open('/app/account', []);
    expect(page.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('has no "Your organizations" group for a user who manages none', async () => {
    const page = await open('/app', []);
    expect(page.textContent).not.toContain('Your organizations');
    expect(links(page)).toEqual([
      ['Omni League', '/'],
      ['Home', '/app'],
      ['Find a league', '/leagues'],
    ]);
  });

  it('lists the one organization an org admin manages, linking to its admin area', async () => {
    const page = await open('/app', [
      { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast', role: 'orgAdmin', leagues: [] },
    ]);
    expect(page.querySelector('ul[aria-label="Your organizations"]')).not.toBeNull();
    expect(page.querySelector('[id]')).toBeNull();
    expect(links(page)).toEqual([
      ['Omni League', '/'],
      ['Home', '/app'],
      ['Find a league', '/leagues'],
      ['Gulf Coast Sport & Social', '/app/organizations/gulf-coast'],
    ]);
  });

  it('links a league organizer to their first league, or to the public page with none', async () => {
    const page = await open('/app', [
      {
        name: 'Sunday Sports',
        slug: 'sunday',
        role: 'leagueOrganizer',
        leagues: [{ name: 'Reverse Coed 4s', slug: 'reverse-coed-4s' }],
      },
      { name: 'Empty Org', slug: 'empty', role: 'leagueOrganizer', leagues: [] },
    ]);
    expect(links(page).slice(3)).toEqual([
      ['Sunday Sports', '/app/organizations/sunday/leagues/reverse-coed-4s'],
      ['Empty Org', '/organizations/empty'],
    ]);
  });

  it('keeps rows 44px tall on touch screens', async () => {
    const page = await open('/app', [
      { name: 'Gulf Coast', slug: 'gulf-coast', role: 'orgAdmin', leagues: [] },
    ]);
    for (const link of page.querySelectorAll('a')) {
      expect(link.className).toMatch(/(^|\s)(pointer-coarse:)?min-h-11(\s|$)/);
    }
  });

  it('draws the loading placeholder through the skeleton, rounded-lg', async () => {
    const page = await open('/app');
    expectSkeletonBoxes(page, { 'rounded-lg': 1 });
  });

  it('shows a loading status, and no group, while the lists load', async () => {
    const page = await open('/app');
    expect(page.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(page.textContent).not.toContain('Your organizations');
    expect(page.textContent).not.toContain('Your teams');
  });

  describe('Find a league and Your teams', () => {
    const TEAMS = [
      { teamId: 'k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e', teamName: 'Sand Sharks' },
      { teamId: 'k1aces', teamName: 'Pair of Aces' },
    ];

    it('lists Find a league under Home, with aria-current on Home only', async () => {
      const page = await open('/app', [], []);
      expect(links(page).slice(1, 3)).toEqual([
        ['Home', '/app'],
        ['Find a league', '/leagues'],
      ]);
      expect(page.querySelectorAll('[aria-current]')).toHaveLength(1);
      expect(page.querySelector('a[href="/app"]')?.getAttribute('aria-current')).toBe('page');
      expect(page.querySelector('a[href="/leagues"]')?.getAttribute('aria-current')).toBeNull();
    });

    it('lists each team under a "Your teams" group, linking to its page', async () => {
      const page = await open('/app', [], TEAMS);
      const group = page.querySelector('ul[aria-label="Your teams"]');
      expect(group).not.toBeNull();
      expect(page.textContent).toContain('Your teams');
      expect(
        [...group!.querySelectorAll('a')].map((a) => [
          a.textContent.trim(),
          a.getAttribute('href'),
        ]),
      ).toEqual([
        ['Sand Sharks', '/app/teams/k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e'],
        ['Pair of Aces', '/app/teams/k1aces'],
      ]);
    });

    it('puts Your teams before Your organizations', async () => {
      const page = await open(
        '/app',
        [{ name: 'Gulf Coast', slug: 'gulf-coast', role: 'orgAdmin', leagues: [] }],
        TEAMS,
      );
      expect(links(page).map(([name]) => name)).toEqual([
        'Omni League',
        'Home',
        'Find a league',
        'Sand Sharks',
        'Pair of Aces',
        'Gulf Coast',
      ]);
    });

    it('has no "Your teams" group for a user on no team', async () => {
      const page = await open('/app', [], []);
      expect(page.textContent).not.toContain('Your teams');
    });

    it('encodes the team id in the link, so an id cannot change the path', async () => {
      const page = await open('/app', [], [{ teamId: '../x?y', teamName: 'Odd' }]);
      expect(page.querySelector('ul[aria-label="Your teams"] a')?.getAttribute('href')).toBe(
        '/app/teams/..%2Fx%3Fy',
      );
    });

    it('marks the team whose page is open as current, and Home as not', async () => {
      const page = await open('/app/teams/k1aces', [], TEAMS);
      const current = [...page.querySelectorAll('[aria-current]')];
      expect(current.map((a) => a.textContent.trim())).toEqual(['Pair of Aces']);
      expect(current[0]?.getAttribute('aria-current')).toBe('page');
    });

    it('keeps rows 44px tall on touch screens', async () => {
      const page = await open('/app', [], TEAMS);
      for (const link of page.querySelectorAll('a')) {
        expect(link.className).toMatch(/(^|\s)(pointer-coarse:)?min-h-11(\s|$)/);
      }
    });

    it('lists the groups that have answered while the other list still loads', async () => {
      const page = await open('/app', undefined, TEAMS);
      expect(page.querySelector('ul[aria-label="Your teams"]')).not.toBeNull();
      expect(page.querySelector('[role="status"]')?.textContent).toContain('Loading');
    });
  });
});
