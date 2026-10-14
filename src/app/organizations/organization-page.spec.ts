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

function subscription(name = HEADER): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

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

// Each live result is saved to localStorage; a saved copy from one test must not seed the next one, nor a later spec file (spec files share one global).
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

  describe('populated', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      harness = await open();
      emit(GULF_COAST);
      await settle(harness);
    });

    it('renders the name as the only h1, on the line of the organization mark', () => {
      const h1s = host(harness).querySelectorAll('main h1');
      expect(h1s).toHaveLength(1);
      expect(text(h1s[0])).toBe('Gulf Coast Sport & Social');
      const mark = h1s[0].previousElementSibling;
      expect(mark?.tagName).toBe('APP-ORGANIZATION-MARK');
      expect(text(mark)).toBe('GC');
      expect(mark?.getAttribute('aria-hidden')).toBe('true');
      expect(mark?.parentElement).toBe(h1s[0].parentElement);
    });

    it('sizes the mark 32px on phones and 48px from 768px', () => {
      const mark = host(harness).querySelector('main app-organization-mark');
      expect(mark?.classList.contains('size-8')).toBe(true);
      expect(mark?.classList.contains('md:size-12')).toBe(true);
    });

    it('scales the title text-2xl, then md:text-5xl', () => {
      const h1 = host(harness).querySelector('main h1');
      expect(h1?.classList.contains('text-2xl')).toBe(true);
      expect(h1?.classList.contains('md:text-5xl')).toBe(true);
    });

    it('says the sports and the league and location counts under the name', () => {
      const h1 = host(harness).querySelector('main h1');
      const line = h1?.parentElement?.nextElementSibling;
      expect(text(line)).toBe('Beach volleyball, soccer, and softball · 5 leagues at 3 locations');
    });

    it('shows the league total beside the Leagues heading, not the number of rows', async () => {
      const section = () =>
        host(harness).querySelector('section[aria-labelledby="leagues-heading"]');
      expect(text(section()?.querySelector('h2'))).toBe('Leagues');
      expect(text(section()?.querySelector('h2')?.nextElementSibling)).toBe('5 leagues');
      emit({ ...GULF_COAST, leagueCount: 13 });
      await settle(harness);
      expect(text(section()?.querySelector('h2')?.nextElementSibling)).toBe('13 leagues');
    });

    it('has no tiles and no eyebrow', () => {
      expect(host(harness).querySelector('main dl')).toBeNull();
      expect(host(harness).querySelector('main')?.textContent).not.toContain('Organization');
    });

    it('lists the leagues as rows, each with its #league-<n> id, not boxed panels', () => {
      const section = host(harness).querySelector('section[aria-labelledby="leagues-heading"]');
      const rows = [...(section?.querySelectorAll('li') ?? [])];
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
      expect(section?.className).not.toContain('ring-1');
      expect(section?.className).not.toContain('shadow');
    });

    it('shows each league row with its division, then its sport and locations', () => {
      const lines = [
        ...host(harness).querySelectorAll('section[aria-labelledby="leagues-heading"] li'),
      ].map((row) => [...row.querySelectorAll('h3, p')].map(text));
      expect(lines).toEqual([
        ['Coed 7v7 Rec', 'Coed · 7v7 · Rec', 'Soccer · Bayside Athletic Complex'],
        ["Men's Over-30 11v11", "Men's · 11v11 · Rec · 30+", 'Soccer · Bayside Athletic Complex'],
        ['Sunday Reverse Coed 4s', 'Coed · 4v4 · BB', 'Beach volleyball · North Beach Sand Courts'],
        ['Thursday Night Coed 2s', 'Coed · 2v2 · B', 'Beach volleyball · North Beach Sand Courts'],
        [
          'Wednesday Coed Slow-Pitch',
          'Coed · 10v10 · Rec',
          'Softball · Flour Bluff Softball Park, Bayside Athletic Complex',
        ],
      ]);
    });

    it('links each league row to its league page, built from the organization and league slugs', () => {
      const rows = [
        ...host(harness).querySelectorAll('section[aria-labelledby="leagues-heading"] li'),
      ];
      expect(rows.map((row) => row.querySelector('a')?.getAttribute('href'))).toEqual(
        GULF_COAST.leagues.map(
          (league) => `/organizations/gulf-coast-sport-social/leagues/${league.slug}`,
        ),
      );
      const locations = host(harness).querySelectorAll(
        'section[aria-labelledby="locations-heading"] a',
      );
      expect(locations).toHaveLength(0);
    });

    it('lists the locations with address and the sports played there, each row with its #location-<n> id', () => {
      const rows = [
        ...host(harness).querySelectorAll('section[aria-labelledby="locations-heading"] li'),
      ];
      expect(rows.map((row) => row.id)).toEqual(['location-1', 'location-2', 'location-3']);
      expect(rows.map((row) => [...row.querySelectorAll('h3, p')].map(text))).toEqual([
        ['Bayside Athletic Complex', '4410 Ocean Dr, Corpus Christi, TX 78412', 'Soccer, softball'],
        ['Flour Bluff Softball Park', '2001 Waldron Rd, Corpus Christi, TX 78418', 'Softball'],
        [
          'North Beach Sand Courts',
          '3500 Surfside Blvd, Corpus Christi, TX 78402',
          'Beach volleyball',
        ],
      ]);
    });

    it('shows a league with no division yet without a division line or an error', async () => {
      const undivided = structuredClone(GULF_COAST);
      delete undivided.leagues[0].divisionLabel;
      emit(undivided);
      await settle(harness);
      const row = host(harness).querySelector('#league-1');
      expect([...(row?.querySelectorAll('h3, p') ?? [])].map(text)).toEqual([
        'Coed 7v7 Rec',
        'Soccer · Bayside Athletic Complex',
      ]);
      expect(host(harness).querySelector('app-server-error-view')).toBeNull();
    });

    it('shows a location with no sports yet (a copy saved earlier) without a sports line', async () => {
      const unsorted = structuredClone(GULF_COAST);
      delete unsorted.locations[0].sportNames;
      emit(unsorted);
      await settle(harness);
      expect(
        [...(host(harness).querySelector('#location-1')?.querySelectorAll('h3, p') ?? [])].map(
          text,
        ),
      ).toEqual(['Bayside Athletic Complex', '4410 Ocean Dr, Corpus Christi, TX 78412']);
    });

    it('renders in the public layout: top bar and footer, no sidebar and no menu button', () => {
      const root = host(harness);
      expect(root.querySelector('app-public-layout')).not.toBeNull();
      expect(root.querySelector('app-shell')).toBeNull();
      expect(root.querySelectorAll('header')).toHaveLength(1);
      expect(root.querySelectorAll('footer')).toHaveLength(1);
      expect([...root.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'))).toEqual([
        'Footer',
      ]);
      expect(root.querySelector('button[aria-label="Open navigation"]')).toBeNull();
      expect(root.querySelector('button')).toBeNull();
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

    it('updates the rows and the hero line in place when page 1 or the totals change', async () => {
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
      expect(text(host(harness).querySelector('#league-1 p'))).toBe('Soccer');
      expect(text(host(harness).querySelector('main h1')?.parentElement?.nextElementSibling)).toBe(
        'Beach volleyball, soccer, and softball · 6 leagues at 4 locations',
      );
    });

    it('removes its og tags and canonical when the visitor leaves the page', async () => {
      await harness.navigateByUrl('/elsewhere');
      expect(metaContent('og:title')).toBeNull();
      expect(metaContent('og:url')).toBeNull();
      expect(canonical()).toBeNull();
    });
  });

  describe('empty organization', () => {
    it('says no leagues are published, with no Leagues or Locations section', async () => {
      const harness = await open(`/organizations/${PORT_ARANSAS.slug}`);
      emit(PORT_ARANSAS);
      await settle(harness);
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('Port Aransas Beach Volleyball Club');
      expect(text(main?.querySelector('h1')?.parentElement?.nextElementSibling)).toBe(
        'No leagues published yet',
      );
      expect(text(main?.querySelector('h2'))).toBe('No leagues yet');
      expect(text(main?.querySelector('h2')?.nextElementSibling)).toBe(
        'Leagues this organization runs will be listed here, with their seasons and how to register.',
      );
      expect(main?.querySelectorAll('section')).toHaveLength(0);
      expect(main?.querySelectorAll('li')).toHaveLength(0);
      expect(main?.textContent).not.toContain('Locations');
    });
  });

  describe('an organization with locations and no league', () => {
    it('still lists its locations, with the empty state in place of the Leagues section', async () => {
      const harness = await open(`/organizations/${PORT_ARANSAS.slug}`);
      emit({
        ...PORT_ARANSAS,
        locationCount: 1,
        locations: [{ name: 'Mustang Courts', address: '1 Mustang Way', sportNames: [] }],
      });
      await settle(harness);
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1')?.parentElement?.nextElementSibling)).toBe(
        'No leagues published yet',
      );
      expect(text(main?.querySelector('h2'))).toBe('No leagues yet');
      expect(main?.querySelector('section[aria-labelledby="leagues-heading"]')).toBeNull();
      expect(
        [...(main?.querySelectorAll('#location-1 h3, #location-1 p') ?? [])].map(text),
      ).toEqual(['Mustang Courts', '1 Mustang Way']);
    });
  });

  describe('loading', () => {
    it('shows a skeleton with the status until all three results have arrived', async () => {
      const harness = await open();
      const results = queryResults(GULF_COAST);
      const main = () => host(harness).querySelector('main');
      expect(text(main()?.querySelector('[role="status"]'))).toBe('Loading the organization.');
      expect(main()?.querySelector('[role="status"]')?.classList.contains('sr-only')).toBe(true);
      expect(main()?.querySelector('h1')).toBeNull();
      subscription().emit(results[HEADER]);
      subscription(LEAGUES).emit(results[LEAGUES]);
      await settle(harness);
      expect(main()?.querySelector('[role="status"]')).not.toBeNull();
      subscription(LOCATIONS).emit(results[LOCATIONS]);
      await settle(harness);
      expect(main()?.querySelector('[role="status"]')).toBeNull();
      expect(text(main()?.querySelector('h1'))).toBe('Gulf Coast Sport & Social');
    });

    it('draws only hidden pulsing bars, so a screen reader hears the status alone', async () => {
      const harness = await open();
      const bars = [...host(harness).querySelectorAll('main app-organization-skeleton span')];
      expect(bars.length).toBeGreaterThan(5);
      for (const bar of bars) {
        expect(bar.getAttribute('aria-hidden')).toBe('true');
        expect(bar.className).toContain('motion-safe:animate-pulse');
      }
      expect(text(host(harness).querySelector('main app-organization-skeleton'))).toBe(
        'Loading the organization.',
      );
    });

    it('sizes the skeleton mark and heading bar like the mark and the h1', async () => {
      const harness = await open();
      const bars = host(harness).querySelectorAll('main app-organization-skeleton span');
      expect(bars[0].classList.contains('size-8')).toBe(true);
      expect(bars[0].classList.contains('md:size-12')).toBe(true);
      expect(bars[1].classList.contains('h-8')).toBe(true);
      expect(bars[1].classList.contains('md:h-12')).toBe(true);
    });

    it('does not show the skeleton for a missing organization or a failed query', async () => {
      const harness = await open('/organizations/does-not-exist');
      subscription().emit(null);
      await settle(harness);
      expect(host(harness).querySelector('app-organization-skeleton')).toBeNull();
    });
  });

  describe('unknown slug', () => {
    it('renders the not-found view in the public layout', async () => {
      const harness = await open('/organizations/does-not-exist');
      subscription().emit(null);
      subscription(LEAGUES).emit({ rows: [], page: 1, pageCount: 0, total: 0 });
      subscription(LOCATIONS).emit({ rows: [], page: 1, pageCount: 0, total: 0 });
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
      expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
      expect(host(harness).querySelector('app-public-layout')).not.toBeNull();
      expect(host(harness).querySelector('nav:not([aria-label="Footer"])')).toBeNull();
      expect(host(harness).querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
      expect(metaContent('og:title')).toBeNull();
      expect(canonical()).toBeNull();
    });
  });

  describe('failed query', () => {
    it('renders the server-error view in the public layout, and a Try again link to the same path', async () => {
      const harness = await open('/organizations/gulf-coast-sport-social?ott=SECRET');
      subscription().fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
      await settle(harness);
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('This page is temporarily unavailable');
      expect(main?.textContent).not.toContain('internal-db');
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe('/organizations/gulf-coast-sport-social');
      expect(host(harness).querySelector('app-public-layout')).not.toBeNull();
      expect(host(harness).querySelector('nav:not([aria-label="Footer"])')).toBeNull();
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
        expect(host(harness).querySelector('nav:not([aria-label="Footer"])')).toBeNull();
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
      expect(host(harness).querySelector('main h1')).not.toBeNull();
    });
  });
});
