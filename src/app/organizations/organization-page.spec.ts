import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import type { PublicOrganizationPage } from './organization-path';
import { GULF_COAST, PORT_ARANSAS, queryResults } from './testing/pages';

let client: FakeConvexClient;

async function open(url = `/organizations/${GULF_COAST.slug}`): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug', component: OrganizationPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  TestBed.tick();
  return harness;
}

const HEADER = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';
const LOCATIONS = 'organizations:listPublicLocations';

/** The one active subscription to the query `name` (the header query by default). */
function subscription(name = HEADER): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

/** Emits the header and page 1 of both lists for `page`, as the three queries return them. */
function emit(page: PublicOrganizationPage): void {
  for (const [name, value] of Object.entries(queryResults(page))) subscription(name).emit(value);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) await harness.fixture.whenStable();
}

function host(harness: RouterTestingHarness): HTMLElement {
  return harness.fixture.nativeElement as HTMLElement;
}

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const head = () => TestBed.inject(DOCUMENT).head;
const metaContent = (property: string) =>
  head().querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

// Each live result is saved to localStorage (#82); a saved copy from one test must not seed the
// next one, nor a later spec file (spec files share one global).
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  // The page removes its tags on destroy; make sure no spec leaks one into the next.
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('OrganizationPage', () => {
  it("subscribes to the header and page 1 of each list with the route's slug only", async () => {
    await open('/organizations/gulf-coast-sport-social?ott=SECRET&leagues=3#league-2');
    expect(
      client.activeSubscriptions
        .map(({ name, args }) => ({ name, args }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ).toEqual([
      { name: HEADER, args: { slug: 'gulf-coast-sport-social' } },
      { name: LEAGUES, args: { slug: 'gulf-coast-sport-social', page: 1 } },
      { name: LOCATIONS, args: { slug: 'gulf-coast-sport-social', page: 1 } },
    ]);
  });

  it('shows nothing but the shell until all three results have arrived', async () => {
    const harness = await open();
    const results = queryResults(GULF_COAST);
    subscription().emit(results[HEADER]);
    subscription(LEAGUES).emit(results[LEAGUES]);
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('nav')).toBeNull();
    subscription(LOCATIONS).emit(results[LOCATIONS]);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
  });

  // The sidebar's Overview link on a sport view (#114) belongs to the page that goes: focus
  // follows the visitor to main, never to body.
  it('moves focus to main when the visitor arrives from another page, and not on the page load', async () => {
    const loaded = await open();
    emit(GULF_COAST);
    await settle(loaded);
    expect(document.activeElement).toBe(document.body);

    await loaded.navigateByUrl('/elsewhere');
    await settle(loaded);
    await loaded.navigateByUrl(`/organizations/${GULF_COAST.slug}`);
    await settle(loaded);
    emit(GULF_COAST);
    await settle(loaded);
    expect(text(host(loaded).querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
    expect(document.activeElement).toBe(host(loaded).querySelector('main#main'));
  });

  // A link to `/organizations/<slug>#locations` from another page (the sidebar's Locations item on
  // a sport view or the league page) navigates before this page's lists have arrived, so the
  // panel does not exist when the link's own scroll runs: the page scrolls once it has rendered.
  describe('the route fragment after a client navigation', () => {
    let scrolled: string[];
    beforeEach(() => {
      scrolled = [];
      // jsdom has no scrollIntoView.
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this.id);
      };
    });
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it('scrolls to the fragment’s element only once the results have arrived', async () => {
      const harness = await open('/elsewhere');
      await harness.navigateByUrl(`/organizations/${GULF_COAST.slug}#locations`);
      await settle(harness);
      expect(scrolled).toEqual([]);

      emit(GULF_COAST);
      await settle(harness);
      expect(scrolled).toEqual(['locations']);
      // Later live updates do not scroll again.
      emit({ ...GULF_COAST, locationCount: 4 });
      await settle(harness);
      expect(scrolled).toEqual(['locations']);
    });

    it('does not scroll on the page load, where the browser has its own fragment handling', async () => {
      const harness = await open(`/organizations/${GULF_COAST.slug}#locations`);
      emit(GULF_COAST);
      await settle(harness);
      expect(scrolled).toEqual([]);
    });

    it('does not scroll without a fragment, and ignores a fragment that names nothing', async () => {
      const harness = await open('/elsewhere');
      await harness.navigateByUrl(`/organizations/${GULF_COAST.slug}`);
      emit(GULF_COAST);
      await settle(harness);
      expect(scrolled).toEqual([]);

      await harness.navigateByUrl('/elsewhere');
      await harness.navigateByUrl(`/organizations/${GULF_COAST.slug}#nothing-here`);
      emit(GULF_COAST);
      await settle(harness);
      expect(scrolled).toEqual([]);
    });
  });

  describe('populated', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      harness = await open();
      emit(GULF_COAST);
      await settle(harness);
    });

    it('renders the name as the only h1, after the "Organization" eyebrow', () => {
      const h1s = host(harness).querySelectorAll('main h1');
      expect(h1s).toHaveLength(1);
      expect(text(h1s[0])).toBe('Gulf Coast Sport & Social');
      expect(text(h1s[0].previousElementSibling)).toBe('Organization');
    });

    it('shows league, location, and distinct sport counts in three tiles', () => {
      const tiles = [...host(harness).querySelectorAll('main dl > div')].map((tile) => [
        text(tile.querySelector('dt')),
        text(tile.querySelector('dd')),
      ]);
      expect(tiles).toEqual([
        ['Leagues', '5'],
        ['Locations', '3'],
        ['Sports', '3'],
      ]);
      expect(host(harness).querySelector('main dl')?.className).toContain('grid-cols-3');
    });

    it('lists the leagues with sport badges and locations, each row with its #league-<n> id', () => {
      const rows = [
        ...host(harness).querySelectorAll('section[aria-labelledby="leagues-heading"] li'),
      ];
      expect(rows.map((row) => row.id)).toEqual([
        'league-1',
        'league-2',
        'league-3',
        'league-4',
        'league-5',
      ]);
      expect(rows.map((row) => text(row.querySelector('h3')))).toEqual(
        GULF_COAST.leagues.map((league) => league.name),
      );
      expect(rows.map((row) => text(row.querySelector('[data-slot="badge"]')))).toEqual([
        'Soccer',
        'Soccer',
        'Beach volleyball',
        'Beach volleyball',
        'Softball',
      ]);
      expect(text(rows[0].querySelector('p'))).toBe('Location: Bayside Athletic Complex');
      expect(text(rows[4].querySelector('p'))).toBe(
        'Locations: Flour Bluff Softball Park, Bayside Athletic Complex',
      );
      expect(text(rows[4].querySelector('p .sr-only'))).toBe('Locations:');
    });

    it('links each league name to its league page, built from the organization and league slugs', () => {
      const rows = [
        ...host(harness).querySelectorAll('section[aria-labelledby="leagues-heading"] li'),
      ];
      expect(rows.map((row) => row.querySelector('h3 a')?.getAttribute('href'))).toEqual(
        GULF_COAST.leagues.map(
          (league) => `/organizations/gulf-coast-sport-social/leagues/${league.slug}`,
        ),
      );
      expect(rows.map((row) => text(row.querySelector('h3 a')))).toEqual(
        GULF_COAST.leagues.map((league) => league.name),
      );
      // Their layout is otherwise unchanged: the name is the row's h3, and the locations are not links.
      expect(rows.every((row) => row.querySelector('p a') === null)).toBe(true);
      const locations = host(harness).querySelectorAll(
        'section[aria-labelledby="locations-heading"] h3 a',
      );
      expect(locations).toHaveLength(0);
    });

    it('lists the locations with addresses, each row with its #location-<n> id', () => {
      const rows = [
        ...host(harness).querySelectorAll('section[aria-labelledby="locations-heading"] li'),
      ];
      expect(rows.map((row) => row.id)).toEqual(['location-1', 'location-2', 'location-3']);
      expect(
        rows.map((row) => [text(row.querySelector('h3')), text(row.querySelector('p'))]),
      ).toEqual(GULF_COAST.locations.map((location) => [location.name, location.address]));
    });

    it('supplies the sidebar: a nav named after the organization, with no id inside', () => {
      const navs = host(harness).querySelectorAll('nav');
      expect(navs).toHaveLength(1);
      const nav = navs[0];
      expect(nav.getAttribute('aria-label')).toBe('Gulf Coast Sport & Social');
      expect(nav.querySelectorAll('[id]')).toHaveLength(0);
      expect(nav.querySelectorAll('[aria-labelledby]')).toHaveLength(0);
      // The initials tile and the name.
      expect(text(nav.querySelector('[aria-hidden="true"].size-10'))).toBe('GC');
      expect(nav.textContent).toContain('Gulf Coast Sport & Social');
      // The menu button exists because the page supplies a sidebar.
      expect(host(harness).querySelector('button[aria-label="Open navigation"]')).not.toBeNull();
    });

    it('links Overview (current page), a view per sport with its count, and Locations, hrefs built from the slug', () => {
      const nav = host(harness).querySelector('nav');
      const overview = nav?.querySelector('a[aria-current="page"]');
      expect(text(overview)).toBe('Overview');
      expect(overview?.getAttribute('href')).toBe('/organizations/gulf-coast-sport-social');
      expect(nav?.querySelectorAll('[aria-current]')).toHaveLength(1);

      expect(
        [...(nav?.querySelectorAll('ul[aria-label="Sports"] a') ?? [])].map((a) => [
          text(a),
          a.getAttribute('href'),
        ]),
      ).toEqual([
        [
          'Beach volleyball 2 leagues',
          '/organizations/gulf-coast-sport-social/sports/beach-volleyball',
        ],
        ['Soccer 2 leagues', '/organizations/gulf-coast-sport-social/sports/soccer'],
        ['Softball 1 league', '/organizations/gulf-coast-sport-social/sports/softball'],
      ]);
      const locations = [...(nav?.querySelectorAll('a') ?? [])].at(-1);
      expect(text(locations)).toBe('Locations 3 locations');
      expect(locations?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social#locations',
      );
      // The Locations link names a panel of the page.
      expect(host(harness).querySelector('main section#locations')).not.toBeNull();
      // No league and no location of the organization.
      expect(nav?.querySelector('ul[aria-label="Leagues"], ul[aria-label="Locations"]')).toBeNull();
      expect(nav?.querySelector('a[href*="#league-"], a[href*="#location-"]')).toBeNull();
    });

    it('sets the title, og tags, and canonical from the result, with the path built from the slug', () => {
      const origin = TestBed.inject(DOCUMENT).location.origin;
      expect(TestBed.inject(Title).getTitle()).toBe('Gulf Coast Sport & Social | Omni League');
      expect(metaContent('og:title')).toBe('Gulf Coast Sport & Social');
      expect(metaContent('og:description')).toBe(
        'Leagues and locations of Gulf Coast Sport & Social on Omni League.',
      );
      expect(metaContent('og:type')).toBe('website');
      expect(metaContent('og:url')).toBe(`${origin}/organizations/gulf-coast-sport-social`);
      expect(canonical()).toBe(`${origin}/organizations/gulf-coast-sport-social`);
      expect(head().querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    });

    it('updates the rows, sidebar, and tiles in place when page 1 or the totals change', async () => {
      // A league that sorts first joins: page 1 gains it and drops its last row, and the totals
      // grow. The same subscriptions deliver it.
      const before = client.subscriptions.length;
      emit({
        ...GULF_COAST,
        leagueCount: 6,
        locationCount: 4,
        leagues: [
          { name: 'Adult League', slug: 'adult-league', sportName: 'Soccer', locationNames: [] },
          ...GULF_COAST.leagues.slice(0, 4),
        ],
      });
      await settle(harness);
      expect(client.subscriptions).toHaveLength(before);
      const names = [
        ...host(harness).querySelectorAll('section[aria-labelledby="leagues-heading"] li h3'),
      ].map(text);
      expect(names).toEqual([
        'Adult League',
        ...GULF_COAST.leagues.slice(0, 4).map((league) => league.name),
      ]);
      expect(host(harness).querySelector('#league-1 p')).toBeNull(); // no locations: no line
      // The sidebar's sports follow the header's counts (#114), not the rows.
      expect(
        [...host(harness).querySelectorAll('nav ul[aria-label="Sports"] a')].map(text),
      ).toEqual(['Beach volleyball 2 leagues', 'Soccer 2 leagues', 'Softball 1 league']);
      expect(text([...host(harness).querySelectorAll('nav a')].at(-1))).toBe(
        'Locations 4 locations',
      );
      expect([...host(harness).querySelectorAll('main dl dd')].map(text)).toEqual(['6', '4', '3']);
    });

    it('tiles show the totals, not the rows shown; the sidebar lists the sports and one Locations item', async () => {
      emit({ ...GULF_COAST, leagueCount: 13, locationCount: 236, sportCount: 2 });
      await settle(harness);
      expect([...host(harness).querySelectorAll('main dl dd')].map(text)).toEqual([
        '13',
        '236',
        '2',
      ]);
      expect(host(harness).querySelectorAll('main li')).toHaveLength(8);
      expect(host(harness).querySelectorAll('nav ul[aria-label="Sports"] a')).toHaveLength(3);
      expect(text([...host(harness).querySelectorAll('nav a')].at(-1))).toBe(
        'Locations 236 locations',
      );
    });

    it('removes its og tags and canonical when the visitor leaves the page', async () => {
      await harness.navigateByUrl('/elsewhere');
      expect(metaContent('og:title')).toBeNull();
      expect(metaContent('og:url')).toBeNull();
      expect(canonical()).toBeNull();
    });
  });

  it('renders the sidebar a second time in the phone sheet without duplicating any id', async () => {
    const harness = await open();
    emit(GULF_COAST);
    await settle(harness);
    host(harness).querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')?.click();
    // The sheet's chunk loads on the first press.
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
    await settle(harness);
    const navs = document.querySelectorAll('nav[aria-label="Gulf Coast Sport & Social"]');
    expect(navs).toHaveLength(2);
    expect(document.querySelector('[role="dialog"] nav')).toBe(navs[1]);
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    // Close the sheet so its overlay does not leak into later specs.
    document.querySelector<HTMLButtonElement>('button[aria-label="Close navigation"]')?.click();
    await settle(harness);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  describe('empty organization', () => {
    it('shows each panel empty state, "None yet" in the Sports group, and tiles 0, 0, 0', async () => {
      const harness = await open(`/organizations/${PORT_ARANSAS.slug}`);
      emit(PORT_ARANSAS);
      await settle(harness);
      const main = host(harness).querySelector('main');
      expect([...(main?.querySelectorAll('dl dd') ?? [])].map(text)).toEqual(['0', '0', '0']);
      expect(main?.querySelectorAll('li')).toHaveLength(0);
      const panel = (heading: string) => {
        const section = main?.querySelector(`section[aria-labelledby="${heading}"]`);
        return [section?.querySelector('h2'), ...(section?.querySelectorAll('p') ?? [])].map(text);
      };
      expect(panel('leagues-heading')).toEqual([
        'Leagues',
        'No leagues yet',
        'Leagues this organization runs will be listed here.',
      ]);
      expect(panel('locations-heading')).toEqual([
        'Locations',
        'No locations yet',
        'Places where this organization plays will be listed here.',
      ]);
      const nav = host(harness).querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Port Aransas Beach Volleyball Club');
      expect(text(nav?.querySelector('.size-10'))).toBe('PA');
      expect(
        [...(nav?.querySelectorAll('p') ?? [])].map(text).filter((t) => t === 'None yet'),
      ).toHaveLength(1);
      // Overview and Locations are the only lists: the Sports group has none to list.
      expect(nav?.querySelectorAll('ul')).toHaveLength(2);
      expect(text([...(nav?.querySelectorAll('a') ?? [])].at(-1))).toBe('Locations 0 locations');
    });
  });

  describe('unknown slug', () => {
    it("renders #23's not-found view in the shell with the top bar only", async () => {
      const harness = await open('/organizations/does-not-exist');
      subscription().emit(null);
      subscription(LEAGUES).emit({ rows: [], page: 1, pageCount: 0, total: 0 });
      subscription(LOCATIONS).emit({ rows: [], page: 1, pageCount: 0, total: 0 });
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
      expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(host(harness).querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
      expect(metaContent('og:title')).toBeNull();
      expect(canonical()).toBeNull();
    });
  });

  describe('failed query', () => {
    it('renders the server-error view with no sidebar, and a Try again link to the same path', async () => {
      const harness = await open('/organizations/gulf-coast-sport-social?ott=SECRET');
      subscription().fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
      await settle(harness);
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('This page is temporarily unavailable');
      expect(main?.textContent).not.toContain('internal-db');
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe('/organizations/gulf-coast-sport-social');
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(host(harness).querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Temporarily unavailable | Omni League');
      expect(canonical()).toBeNull();
    });

    for (const name of [LEAGUES, LOCATIONS]) {
      it(`renders the server-error view when ${name} fails, until it delivers a result`, async () => {
        const harness = await open();
        const results = queryResults(GULF_COAST);
        for (const other of [HEADER, LEAGUES, LOCATIONS].filter((n) => n !== name)) {
          subscription(other).emit(results[other]);
        }
        subscription(name).fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
        await settle(harness);
        expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
        expect(host(harness).querySelector('main')?.textContent).not.toContain('internal-db');
        expect(host(harness).querySelector('nav')).toBeNull();
        subscription(name).emit(results[name]);
        await settle(harness);
        expect(host(harness).querySelector('app-server-error-view')).toBeNull();
        expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
      });
    }

    it('is replaced by the page once the live subscription delivers a result', async () => {
      const harness = await open();
      subscription().fail(new Error('down'));
      await settle(harness);
      expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
      emit(GULF_COAST);
      await settle(harness);
      expect(host(harness).querySelector('app-server-error-view')).toBeNull();
      expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
      expect(host(harness).querySelector('nav')).not.toBeNull();
    });
  });
});
