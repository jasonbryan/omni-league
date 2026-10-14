import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { buttonVariants } from '../ui/button/hlm-button';
import { YourOrganizations, organizationInitials } from './your-organizations';

@Component({
  imports: [YourOrganizations],
  template: '<app-your-organizations />',
})
class Host {}

const COASTAL = {
  name: 'Coastal Bend Rec Club',
  slug: 'coastal-bend-rec-club',
  role: 'orgAdmin',
  leagues: [],
};
const MUSTANG = {
  name: 'Mustang Island Beach Volleyball',
  slug: 'mustang-island-beach-volleyball',
  role: 'orgAdmin',
  leagues: [],
};
const RIVERBEND = {
  name: 'Riverbend Softball Association',
  slug: 'riverbend-softball-association',
  role: 'leagueOrganizer',
  leagues: [],
};
const GULF_COAST = {
  name: 'Gulf Coast Sport & Social',
  slug: 'gulf-coast-sport-social',
  role: 'leagueOrganizer',
  leagues: [
    { name: 'Friday Night Coed 6s', slug: 'friday-night-coed-6s' },
    { name: 'Sunday Reverse Coed 4s', slug: 'sunday-reverse-coed-4s' },
    { name: 'Thursday Night Coed 2s', slug: 'thursday-night-coed-2s' },
  ],
};

describe('YourOrganizations', () => {
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let section: HTMLElement;

  async function open() {
    convex = new FakeConvexClient();
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([{ path: '', component: Host }]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/');
    section = harness.routeNativeElement!.querySelector('section')!;
  }

  async function answer(rows: unknown): Promise<FakeSubscription> {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    const subscription = convex.activeSubscriptions[0];
    subscription.emit(rows);
    await harness.fixture.whenStable();
    return subscription;
  }

  const rows = () => [...section.querySelectorAll('ul[role="list"].divide-y > li')];
  const link = (row: Element, text: string) =>
    [...row.querySelectorAll('a')].find((a) => a.textContent?.includes(text));
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();

  it('asks organizations.listMine with no argument, and only once Convex has accepted the token', async () => {
    await open();
    TestBed.tick();
    expect(convex.subscriptions).toEqual([]);
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    expect(convex.activeSubscriptions.map((s) => [s.name, s.args])).toEqual([
      ['organizations:listMine', {}],
    ]);
  });

  it('loading (state 1): the heading, two placeholder rows, and a polite status', async () => {
    await open();
    expect(section.getAttribute('aria-labelledby')).toBe('organizations-heading');
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Your organizations');
    expect(section.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Loading your organizations.',
    );
    expect(section.querySelectorAll('[aria-hidden="true"].divide-y > div')).toHaveLength(2);
    expect(section.querySelector('a')).toBeNull();
  });

  it('none (state 2): the empty state with the Create an organization button', async () => {
    await open();
    await answer([]);
    expect(section.querySelector('[role="status"]')).toBeNull();
    expect(text(section.querySelector('p.font-medium'))).toBe('No organizations yet');
    expect(text(section)).toContain(
      'Create one to run your leagues on Omni League, or ask an org admin to invite you to theirs.',
    );
    const links = [...section.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/app/organizations/new');
    expect(text(links[0])).toBe('Create an organization');
    expect([...links[0].classList].sort()).toEqual(
      buttonVariants({ size: 'lg' }).split(' ').sort(),
    );
    expect(section.querySelector('ul')).toBeNull();
  });

  it('one organization (state 3): a row with initials, name, role, Public page, and Manage', async () => {
    await open();
    await answer([COASTAL]);
    const header = section.querySelector('div.border-b');
    expect(text(header)).toBe('Your organizationsCreate an organization');
    expect(header?.querySelector('a')?.getAttribute('href')).toBe('/app/organizations/new');
    expect([...header!.querySelector('a')!.classList].sort()).toEqual(
      buttonVariants({ variant: 'outline', size: 'lg' }).split(' ').sort(),
    );

    expect(section.querySelector('ul')?.getAttribute('role')).toBe('list');
    expect(rows()).toHaveLength(1);
    const row = rows()[0];
    expect(text(row.querySelector('span[aria-hidden="true"]'))).toBe('CB');
    expect(text(row.querySelector('h3'))).toBe('Coastal Bend Rec Club');
    expect(text(row.querySelector('p'))).toBe('Org admin');
    const publicPage = link(row, 'Public page')!;
    expect(publicPage.getAttribute('href')).toBe('/organizations/coastal-bend-rec-club');
    expect(text(publicPage)).toBe('Public page: Coastal Bend Rec Club');
    expect(publicPage.querySelector('.sr-only')?.textContent).toBe(': Coastal Bend Rec Club');
    const manage = link(row, 'Manage')!;
    expect(manage.getAttribute('href')).toBe('/app/organizations/coastal-bend-rec-club');
    expect(text(manage)).toBe('Manage Coastal Bend Rec Club');
    expect(manage.querySelector('.sr-only')?.textContent).toBe(' Coastal Bend Rec Club');
    expect([...manage.classList].sort()).toEqual([...publicPage.classList].sort());
    expect(row.querySelectorAll('a')).toHaveLength(2);
    expect([...row.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/organizations/coastal-bend-rec-club',
      '/app/organizations/coastal-bend-rec-club',
    ]);
  });

  it('a league organizer gets no Manage: the admin area is for org admins', async () => {
    await open();
    await answer([COASTAL, RIVERBEND]);
    expect(rows().map((row) => link(row, 'Manage')?.getAttribute('href') ?? null)).toEqual([
      '/app/organizations/coastal-bend-rec-club',
      null,
    ]);
    expect(rows()[1].querySelectorAll('a')).toHaveLength(1);
  });

  it('several organizations (state 4): one row each, in the order the query gives, with the role names', async () => {
    await open();
    await answer([COASTAL, MUSTANG, RIVERBEND]);
    expect(rows().map((row) => text(row.querySelector('h3')))).toEqual([
      'Coastal Bend Rec Club',
      'Mustang Island Beach Volleyball',
      'Riverbend Softball Association',
    ]);
    expect(rows().map((row) => text(row.querySelector('p')))).toEqual([
      'Org admin',
      'Org admin',
      'League organizer',
    ]);
    expect(rows().map((row) => text(row.querySelector('span[aria-hidden="true"]')))).toEqual([
      'CB',
      'MI',
      'RS',
    ]);
    expect(rows().map((row) => link(row, 'Public page')?.getAttribute('href'))).toEqual([
      '/organizations/coastal-bend-rec-club',
      '/organizations/mustang-island-beach-volleyball',
      '/organizations/riverbend-softball-association',
    ]);
    expect(rows().map((row) => link(row, 'Manage')?.getAttribute('href') ?? null)).toEqual([
      '/app/organizations/coastal-bend-rec-club',
      '/app/organizations/mustang-island-beach-volleyball',
      null,
    ]);
  });

  describe('assigned leagues', () => {
    const leagueLinks = (row: Element) => [...row.querySelectorAll('ul ul a, li ul a')];

    it('one league (state 1): "Your leagues" and a link to the league management page, no Manage', async () => {
      await open();
      await answer([
        {
          ...GULF_COAST,
          leagues: [{ name: 'Friday Night Coed 6s', slug: 'friday-night-coed-6s' }],
        },
      ]);
      const row = rows()[0];
      expect(text(row.querySelector('p'))).toBe('League organizer');
      expect(link(row, 'Manage')).toBeUndefined();
      expect(link(row, 'Public page')?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social',
      );
      const label = row.querySelector('p[id$="-leagues-label"]')!;
      expect(text(label)).toBe('Your leagues');
      const list = row.querySelector('ul')!;
      expect(list.getAttribute('role')).toBe('list');
      expect(list.getAttribute('aria-labelledby')).toBe(label.id);
      expect(leagueLinks(row).map((a) => [text(a), a.getAttribute('href')])).toEqual([
        [
          'Friday Night Coed 6s',
          '/app/organizations/gulf-coast-sport-social/leagues/friday-night-coed-6s',
        ],
      ]);
      for (const icon of leagueLinks(row)[0].querySelectorAll('ng-icon')) {
        expect(icon.getAttribute('aria-hidden')).toBe('true');
      }
      expect(row.querySelectorAll('ng-icon[name="lucideTrophy"]')).toHaveLength(1);
      expect(row.querySelectorAll('ng-icon[name="lucideChevronRight"]')).toHaveLength(1);
    });

    it('several leagues (state 2): one link each, in the order the query gives, beside an unchanged org admin row', async () => {
      await open();
      await answer([GULF_COAST, MUSTANG]);
      expect(leagueLinks(rows()[0]).map((a) => text(a))).toEqual([
        'Friday Night Coed 6s',
        'Sunday Reverse Coed 4s',
        'Thursday Night Coed 2s',
      ]);
      expect(leagueLinks(rows()[0]).map((a) => a.getAttribute('href'))).toEqual([
        '/app/organizations/gulf-coast-sport-social/leagues/friday-night-coed-6s',
        '/app/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s',
        '/app/organizations/gulf-coast-sport-social/leagues/thursday-night-coed-2s',
      ]);
      expect(rows()[1].querySelector('ul')).toBeNull();
      expect(rows()[1].textContent).not.toContain('Your leagues');
      expect(rows()[1].textContent).not.toContain('No leagues are assigned');
      expect([...rows()[1].querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
        '/organizations/mustang-island-beach-volleyball',
        '/app/organizations/mustang-island-beach-volleyball',
      ]);
    });

    it('league links use the sidebar-item style, 36px tall', async () => {
      await open();
      await answer([GULF_COAST]);
      expect(leagueLinks(rows()[0])).toHaveLength(3);
      for (const a of leagueLinks(rows()[0])) {
        expect([...a.classList].sort()).toEqual(
          'flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted'
            .split(' ')
            .sort(),
        );
      }
    });

    it('no leagues (state 3): the row stays with the no-leagues line and no links', async () => {
      await open();
      await answer([RIVERBEND]);
      const row = rows()[0];
      expect(text(row.querySelector('h3'))).toBe('Riverbend Softball Association');
      expect(text(row)).toContain(
        'No leagues are assigned to you here. Ask an org admin of Riverbend Softball Association to assign one.',
      );
      expect(row.querySelector('ul')).toBeNull();
      expect(row.textContent).not.toContain('Your leagues');
      expect([...row.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
        '/organizations/riverbend-softball-association',
      ]);
      expect(row.querySelector('ng-icon[name="lucideInfo"]')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    });

    it('org admin only (state 4): rows have no leagues list', async () => {
      await open();
      await answer([COASTAL]);
      expect(rows()[0].textContent).not.toContain('Your leagues');
      expect(rows()[0].textContent).not.toContain('No leagues are assigned');
      expect(rows()[0].querySelector('ul')).toBeNull();
    });

    it('encodes the slugs in the link, so a slug cannot change the path', async () => {
      await open();
      await answer([
        { ...GULF_COAST, slug: 'a b', leagues: [{ name: 'X', slug: '../admin?x=1#y' }] },
      ]);
      expect(leagueLinks(rows()[0])[0].getAttribute('href')).toBe(
        '/app/organizations/a%20b/leagues/..%2Fadmin%3Fx%3D1%23y',
      );
    });

    it('gives each organization its own list labels, so two lists never share an id', async () => {
      await open();
      await answer([GULF_COAST, { ...GULF_COAST, name: 'Other', slug: 'other-org' }]);
      const ids = [...section.querySelectorAll('p[id$="-leagues-label"]')].map((p) => p.id);
      expect(ids).toEqual(['gulf-coast-sport-social-leagues-label', 'other-org-leagues-label']);
    });
  });

  it('follows the live query: a new organization appears without a reload', async () => {
    await open();
    const subscription = await answer([]);
    expect(rows()).toHaveLength(0);
    subscription.emit([COASTAL]);
    await harness.fixture.whenStable();
    expect(rows()).toHaveLength(1);
  });

  it('a failed query shows the form alert pattern, not an endless placeholder', async () => {
    await open();
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
    convex.activeSubscriptions[0]?.fail(new Error('Server Error'));
    await harness.fixture.whenStable();
    expect(section.querySelector('[role="status"]')).toBeNull();
    const alert = section.querySelector('[role="alert"]');
    expect(text(alert)).toBe(
      'Your organizations could not be loaded. Check your connection and try again.',
    );
    expect(alert?.textContent).not.toContain('Server Error');
  });
});

describe('organizationInitials', () => {
  it.each([
    ['Coastal Bend Rec Club', 'CB'],
    ['Mustang Island Beach Volleyball', 'MI'],
    ['Gulf Coast Sport & Social', 'GC'],
    ['Riverbend', 'R'],
    ['  élan   vital ', 'ÉV'],
    ['', ''],
  ])('%j gives %j', (name, initials) => {
    expect(organizationInitials(name)).toBe(initials);
  });
});
