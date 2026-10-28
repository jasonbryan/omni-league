import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
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

  async function open(url = '/app', mine?: Mine[]) {
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

  it('asks organizations.listMine only once Convex has accepted the token', async () => {
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
    expect(convex.activeSubscriptions.map((s) => s.name)).toEqual(['organizations:listMine']);
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
    expect(links(page).slice(2)).toEqual([
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

  it('shows a loading status, and no group, while the list loads', async () => {
    const page = await open('/app');
    expect(page.querySelector('[role="status"]')?.textContent).toContain('Loading');
    expect(page.textContent).not.toContain('Your organizations');
  });
});
