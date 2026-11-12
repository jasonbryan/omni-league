import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes.app';
import { AuthService } from '../core/auth/auth.service';
import { FakeAuthClient, provideFakeAuthClient } from '../core/auth/testing/fake-auth-client';
import { CONVEX_CLIENT } from '../core/data/convex';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { PRIMARY_BUTTON } from '../ui/button/button-classes';
import { expectBadge } from '../ui/testing/badge';
import { expectBareCard } from '../ui/testing/card';
import { allRadiusClasses } from '../ui/testing/radius-classes';
import { AccountPage } from './account-page';

@Component({ template: 'home' })
class Home {}

const NOW = Date.UTC(2027, 4, 1, 15);

const SAND_SHARKS = {
  teamId: 'k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e',
  teamName: 'Sand Sharks',
  seasonName: 'Summer 2027',
  leagueName: 'Sunday Reverse Coed 4s',
  organizationName: 'Gulf Coast Sport & Social',
  role: 'captain',
  seasonStartDate: '2027-06-06',
  seasonEndDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  minimumRosterSize: 4,
  rosterCount: 3,
};
const PAIR_OF_ACES = {
  teamId: 'k1aces',
  teamName: 'Pair of Aces',
  seasonName: 'Summer 2027',
  leagueName: 'Thursday Night Coed 2s',
  organizationName: 'Gulf Coast Sport & Social',
  role: 'player',
  seasonStartDate: '2027-06-03',
  seasonEndDate: '2027-08-26',
  registrationDeadline: '2027-05-30',
  minimumRosterSize: 2,
  rosterCount: 2,
};
const BAYSIDE = {
  ...PAIR_OF_ACES,
  teamId: 'k1bayside',
  teamName: 'Bayside Strikers',
  role: 'guardian',
};
const COACHED = { ...PAIR_OF_ACES, teamId: 'k1coached', teamName: 'Coached Crew', role: 'coach' };
const ORGANIZATION = {
  name: 'Coastal Bend Rec Club',
  slug: 'coastal-bend-rec-club',
  role: 'orgAdmin',
  leagues: [],
};

describe('AccountPage', () => {
  let auth: FakeAuthClient;
  let convex: FakeConvexClient;
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  async function open(now = NOW) {
    vi.useFakeTimers({ toFake: ['Date'], now });
    auth = new FakeAuthClient();
    convex = new FakeConvexClient();
    TestBed.configureTestingModule({
      providers: [
        provideFakeAuthClient(auth),
        { provide: CONVEX_CLIENT, useValue: convex },
        provideRouter([
          { path: 'app', component: AccountPage },
          { path: '', component: Home },
        ]),
      ],
    });
    auth.emitSession({ id: 's1' });
    harness = await RouterTestingHarness.create('/app');
    page = harness.routeNativeElement!;
  }

  function accept() {
    TestBed.inject(AuthService).onChange(true);
    TestBed.tick();
  }

  async function show(
    teams: unknown[] | undefined,
    organizations: unknown[] | undefined = [],
    me: { name: string } | undefined = { name: 'Tasha Greene' },
  ) {
    await open();
    accept();
    for (const subscription of convex.activeSubscriptions) {
      const value =
        subscription.name === 'teams:listMine'
          ? teams
          : subscription.name === 'organizations:listMine'
            ? organizations
            : subscription.name === 'users:me'
              ? me
              : undefined;
      if (value !== undefined) subscription.emit(value);
    }
    await harness.fixture.whenStable();
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const main = () => page.querySelector('main')!;
  const heading = (level: number, name: string) =>
    [...main().querySelectorAll(`h${level}`)].find((h) => text(h) === name);
  const facts = (card: Element): Record<string, string | undefined> =>
    Object.fromEntries(
      [...card.querySelectorAll('dt')].map((dt) => [text(dt) ?? '', text(dt.nextElementSibling)]),
    );
  const cards = () => [...main().querySelectorAll('section[aria-labelledby="teams-heading"] li')];
  const nextStepRegion = () => main().querySelector('section[aria-labelledby="next-heading"]');

  afterEach(() => vi.useRealTimers());

  describe('data', () => {
    it('asks users.me, teams.listMine and organizations.listMine only once Convex has accepted the token', async () => {
      await open();
      TestBed.tick();
      expect(convex.subscriptions).toEqual([]);
      accept();
      const asked = convex.activeSubscriptions.map((s) => s.name);
      expect(asked).toContain('users:me');
      expect(asked.filter((name) => name === 'teams:listMine').length).toBeGreaterThan(0);
      expect(asked.filter((name) => name === 'organizations:listMine').length).toBeGreaterThan(0);
    });
  });

  describe('greeting', () => {
    it.each([
      ['Tasha Greene', 'Hi, Tasha'],
      ['  Devon  Park ', 'Hi, Devon'],
      ['Cher', 'Hi, Cher'],
      ['   ', 'Hi'],
    ])('reads %j as the one h1 %j, with "Next step" an h2', async (name, expected) => {
      await show([SAND_SHARKS], [], { name });
      expect([...page.querySelectorAll('h1')].map(text)).toEqual([expected]);
      expect(text(page.querySelector('main > div > p'))).toBe('Your teams and registrations.');
      expect(nextStepRegion()?.querySelector('h2')?.textContent?.trim()).toBe('Next step');
    });

    it('reads "Hi" until users.me answers', async () => {
      await open();
      accept();
      expect([...page.querySelectorAll('h1')].map(text)).toEqual(['Hi']);
    });

    it('keeps the route title "Home | Omni League"', () => {
      expect(appRoutes.find((route) => route.path === '')?.title).toBe('Home | Omni League');
    });

    it('has no Sign out or signed-in account panel', async () => {
      await show([]);
      expect(page.querySelector('section[aria-label="Signed-in account"]')).toBeNull();
      expect(
        [...page.querySelectorAll('main button')].filter((b) =>
          b.textContent?.includes('Sign out'),
        ),
      ).toEqual([]);
      expect(main().textContent).not.toContain('Signed in as');
    });
  });

  describe('next step', () => {
    it('names the captained team that is short, its league, minimum and deadline, and links to the team page', async () => {
      await show([SAND_SHARKS, PAIR_OF_ACES]);
      const region = nextStepRegion()!;
      expect(text(region.querySelector('p.font-semibold'))).toBe('Sand Sharks needs 1 more player');
      expect(text(region.querySelectorAll('p')[1])).toBe(
        'Sunday Reverse Coed 4s needs 4 players per team by May 23, 2027.',
      );
      const link = region.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('/app/teams/k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e');
      expect(text(link)).toBe('Invite players to Sand Sharks');
      expect(text(link.querySelector('.sr-only'))).toBe('to Sand Sharks');
    });

    it('says "players" when more than one is needed', async () => {
      await show([{ ...SAND_SHARKS, rosterCount: 1 }]);
      expect(text(nextStepRegion()?.querySelector('p.font-semibold'))).toBe(
        'Sand Sharks needs 3 more players',
      );
    });

    it('shows one next step, for the sooner deadline', async () => {
      const sooner = {
        ...SAND_SHARKS,
        teamId: 'k2',
        teamName: 'Zebras',
        registrationDeadline: '2027-05-10',
      };
      await show([SAND_SHARKS, sooner]);
      expect(main().querySelectorAll('section[aria-labelledby="next-heading"]')).toHaveLength(1);
      expect(text(nextStepRegion()?.querySelector('p.font-semibold'))).toBe(
        'Zebras needs 1 more player',
      );
    });

    it('shows none when every captained team meets its minimum', async () => {
      await show([{ ...SAND_SHARKS, rosterCount: 4 }, PAIR_OF_ACES]);
      expect(nextStepRegion()).toBeNull();
    });

    it('shows none once registration has closed', async () => {
      await open(Date.UTC(2027, 4, 24, 15));
      accept();
      for (const subscription of convex.activeSubscriptions) {
        if (subscription.name === 'teams:listMine') subscription.emit([SAND_SHARKS]);
        if (subscription.name === 'organizations:listMine') subscription.emit([]);
      }
      await harness.fixture.whenStable();
      expect(nextStepRegion()).toBeNull();
      expect(cards()).toHaveLength(1);
    });

    it('draws the Invite players link as a primary button', async () => {
      await show([SAND_SHARKS]);
      const link = nextStepRegion()!.querySelector('a')!;
      expect(link.getAttribute('data-slot')).toBe('button');
      for (const token of PRIMARY_BUTTON.split(' ')) expect(link.classList).toContain(token);
    });
  });

  describe('Your teams', () => {
    it('is an h2 over one card per team, each team name an h3 link', async () => {
      await show([SAND_SHARKS, PAIR_OF_ACES]);
      expect(heading(2, 'Your teams')).toBeTruthy();
      expect(
        main()
          .querySelector('section[aria-labelledby="teams-heading"]')
          ?.getAttribute('aria-labelledby'),
      ).toBe('teams-heading');
      expect(cards().map((card) => text(card.querySelector('h3')))).toEqual([
        'Sand Sharks',
        'Pair of Aces',
      ]);
      expect(cards().map((card) => card.querySelector('h3 a')?.getAttribute('href'))).toEqual([
        '/app/teams/k57a2rbq9x1hz3m4c8tn0pwd2s6v1f9e',
        '/app/teams/k1aces',
      ]);
    });

    it('shows league and season, role, season dates, and roster progress as text', async () => {
      await show([SAND_SHARKS, PAIR_OF_ACES]);
      const [sharks, aces] = cards();
      expect(text(sharks?.querySelector('h3 + p'))).toBe('Sunday Reverse Coed 4s · Summer 2027');
      expect(text(sharks?.querySelector('[data-slot="badge"]'))).toBe('Captain');
      expect(facts(sharks)).toEqual({ Season: 'Jun 6 – Aug 29', Roster: '3 of 4 needed' });
      expect(text(aces?.querySelector('h3 + p'))).toBe('Thursday Night Coed 2s · Summer 2027');
      expect(text(aces?.querySelector('[data-slot="badge"]'))).toBe('Player');
      expect(facts(aces)).toEqual({ Season: 'Jun 3 – Aug 26', Roster: '2 of 2 needed' });
    });

    it('marks Captain with a crown and the roles as secondary badges; an unknown role has no badge', async () => {
      await show([SAND_SHARKS, PAIR_OF_ACES, BAYSIDE, COACHED]);
      const badges = cards().map((card) => card.querySelector('[data-slot="badge"]'));
      expect(badges.map(text)).toEqual(['Captain', 'Player', 'Guardian', undefined]);
      expect(badges[0]?.querySelector('ng-icon')?.getAttribute('name')).toBe('lucideCrown');
      expect(badges[1]?.querySelector('ng-icon')).toBeNull();
      expectBadge(badges[0], 'secondary', 'default');
      expect(text(cards()[3])).not.toContain('coach');
    });

    it('shows both years when a season crosses a year', async () => {
      await show([{ ...SAND_SHARKS, seasonStartDate: '2026-12-06', seasonEndDate: '2027-02-28' }]);
      expect(facts(cards()[0])).toMatchObject({ Season: 'Dec 6, 2026 – Feb 28, 2027' });
    });

    it('says how many players are on a roster over the minimum', async () => {
      await show([{ ...PAIR_OF_ACES, rosterCount: 5 }]);
      expect(facts(cards()[0])).toMatchObject({ Roster: '5 players' });
    });

    it('draws the roster bar for sighted users only, as wide as the roster is complete', async () => {
      await show([SAND_SHARKS, { ...PAIR_OF_ACES, rosterCount: 5 }]);
      const bars = cards().map((card) =>
        card.querySelector<HTMLElement>('[aria-hidden="true"] > div'),
      );
      expect(bars.map((bar) => bar?.style.width)).toEqual(['75%', '100%']);
      expect(cards()[0]?.querySelector('[role="progressbar"]')).toBeNull();
    });

    it('keeps the title link 44px tall on touch screens', async () => {
      await show([SAND_SHARKS]);
      const link = cards()[0].querySelector('h3 a')!;
      expect(link.className).toContain('pointer-coarse:min-h-11');
    });

    it('encodes the team id in the links, so an id cannot change the path', async () => {
      await show([{ ...SAND_SHARKS, teamId: '../x?y' }]);
      expect(cards()[0]?.querySelector('h3 a')?.getAttribute('href')).toBe('/app/teams/..%2Fx%3Fy');
      expect(nextStepRegion()?.querySelector('a')?.getAttribute('href')).toBe(
        '/app/teams/..%2Fx%3Fy',
      );
    });

    it('follows the live query: a new team appears without a reload', async () => {
      await show([PAIR_OF_ACES]);
      expect(cards()).toHaveLength(1);
      for (const subscription of convex.activeSubscriptions) {
        if (subscription.name === 'teams:listMine') {
          subscription.emit([PAIR_OF_ACES, SAND_SHARKS]);
        }
      }
      await harness.fixture.whenStable();
      expect(cards()).toHaveLength(2);
    });
  });

  describe('organizations', () => {
    it('ends a home with teams and no organization with "Run a league?" and Create an organization', async () => {
      await show([SAND_SHARKS], []);
      const prompt = [...main().querySelectorAll('p')].find((p) =>
        text(p)?.startsWith('Run a league?'),
      );
      expect(text(prompt)).toBe('Run a league? Create an organization');
      expect(prompt?.querySelector('a')?.getAttribute('href')).toBe('/app/organizations/new');
      const last = main().querySelector('main > div')!.lastElementChild;
      expect(last?.tagName).toBe('APP-HOME-RUN-A-LEAGUE');
      expect(last?.contains(prompt!)).toBe(true);
    });

    it('does not show "Run a league?" to a user with an organization, and lists no organization in the body', async () => {
      await show([SAND_SHARKS], [ORGANIZATION]);
      expect(main().textContent).not.toContain('Run a league?');
      expect(main().textContent).not.toContain('Coastal Bend Rec Club');
      expect(main().textContent).not.toContain('Your organizations');
    });
  });

  describe('new user', () => {
    it('shows "You\'re not on a team yet" with Find a league, and "Run a league?" with no organization', async () => {
      await show([], []);
      expect(text(page.querySelector('main > div > p'))).toBe(
        'Your teams and registrations will show here.',
      );
      expect(nextStepRegion()).toBeNull();
      expect(heading(2, 'Your teams')).toBeUndefined();
      expect(heading(2, "You're not on a team yet")).toBeTruthy();
      expect(main().textContent).toContain(
        'Find a league, then register a team or register as a free agent. Got an invite link from a captain? Open it to join their team.',
      );
      const find = [...main().querySelectorAll('a')].find((a) => text(a) === 'Find a league')!;
      expect(find.getAttribute('href')).toBe('/leagues');
      expect(heading(2, 'Run a league?')).toBeTruthy();
      const create = [...main().querySelectorAll('a')].find(
        (a) => text(a) === 'Create an organization',
      )!;
      expect(create.getAttribute('href')).toBe('/app/organizations/new');
    });

    it('shows no "Run a league?" to a user with an organization but no team, and lists none in the body', async () => {
      await show([], [ORGANIZATION]);
      expect(heading(2, "You're not on a team yet")).toBeTruthy();
      expect(main().textContent).not.toContain('Run a league?');
      expect(main().textContent).not.toContain('Coastal Bend Rec Club');
    });
  });

  describe('Notifications', () => {
    it('links to the notifications page from a Notifications panel, named Manage notifications', async () => {
      await show([SAND_SHARKS]);
      const panel = main().querySelector('section[aria-labelledby="app-notifications-heading"]');
      expect(panel?.querySelector('h2')?.textContent?.trim()).toBe('Notifications');
      const link = panel?.querySelector('a');
      expect(link?.getAttribute('href')).toBe('/app/notifications');
      expect(text(link)).toBe('Manage notifications');
    });

    it('draws the panel in a bare helm card with its padding', async () => {
      await show([SAND_SHARKS]);
      expectBareCard(
        main().querySelector('section[aria-labelledby="app-notifications-heading"]'),
        'max-w-xl px-4 py-4 md:px-5 md:py-5',
      );
    });
  });

  describe('loading', () => {
    it('shows the skeleton and a polite status while the teams load, with no card', async () => {
      await open();
      accept();
      expect(text(main().querySelector('[role="status"]'))).toBe('Loading your teams.');
      expect(cards()).toHaveLength(0);
      expect(main().querySelector('main > div a, a[data-slot="button"]')).toBeNull();
      const placeholders = main().querySelectorAll('[data-slot="home-skeleton-card"]');
      expect(placeholders).toHaveLength(2);
    });

    it('draws every placeholder with one radius class', async () => {
      await open();
      accept();
      const pieces = main().querySelectorAll('[class~="motion-safe:animate-pulse"]');
      expect(pieces.length).toBeGreaterThan(0);
      for (const radii of allRadiusClasses(pieces)) expect(radii).toHaveLength(1);
    });

    it('keeps the skeleton while the organizations are still loading, so "Run a league?" never arrives late', async () => {
      await open();
      accept();
      for (const subscription of convex.activeSubscriptions) {
        if (subscription.name === 'teams:listMine') subscription.emit([SAND_SHARKS]);
      }
      await harness.fixture.whenStable();
      expect(text(main().querySelector('[role="status"]'))).toBe('Loading your teams.');
      expect(cards()).toHaveLength(0);
    });

    it('replaces the skeleton with the cards, and the status goes away', async () => {
      await show([SAND_SHARKS, PAIR_OF_ACES]);
      expect(main().querySelector('[role="status"]')).toBeNull();
      expect(main().querySelector('[data-slot="home-skeleton-card"]')).toBeNull();
      expect(cards()).toHaveLength(2);
    });
  });

  describe('error', () => {
    it('shows an alert with Try again in place of the cards, and keeps Notifications', async () => {
      await open();
      accept();
      for (const subscription of convex.activeSubscriptions) {
        if (subscription.name === 'teams:listMine') {
          subscription.fail(new Error('Server Error'));
        }
      }
      await harness.fixture.whenStable();
      expect(main().querySelector('[role="status"]')).toBeNull();
      const alert = main().querySelector('[role="alert"]');
      expect(text(alert)).toContain('Your teams could not be loaded.');
      expect(text(alert)).toContain('Check your connection.');
      expect(alert?.textContent).not.toContain('Server Error');
      const retry = alert?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe('/app');
      expect(cards()).toHaveLength(0);
      expect(
        main().querySelector('section[aria-labelledby="app-notifications-heading"]'),
      ).not.toBeNull();
    });
  });
});
