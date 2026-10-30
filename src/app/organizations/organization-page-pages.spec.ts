import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import type { PublicOrganizationPage } from './organization-path';
import { listPage, PAGED, pagedResults } from './testing/pages';

const HEADER = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';
const LOCATIONS = 'organizations:listPublicLocations';
const ORG = `/organizations/${PAGED.slug}`;

let client: FakeConvexClient;

async function open(url = ORG): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug', component: OrganizationPage },
        { path: 'organizations/:orgSlug/sports/:sport', component: OrganizationPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  TestBed.tick();
  return harness;
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

function emit(results: Record<string, unknown>, names = Object.keys(results)): void {
  for (const name of names) subscription(name).emit(results[name]);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

async function openWith(
  harness: Promise<RouterTestingHarness>,
  results: Record<string, unknown>,
): Promise<RouterTestingHarness> {
  const opened = await harness;
  emit(results);
  await settle(opened);
  return opened;
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const head = () => TestBed.inject(DOCUMENT).head;
const origin = () => TestBed.inject(DOCUMENT).location.origin;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const ogUrl = () =>
  head().querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null;

const control = (harness: RouterTestingHarness, label: string) =>
  host(harness).querySelector(`nav[aria-label="${label}"]`);
const leaguesControl = (harness: RouterTestingHarness) => control(harness, 'Leagues pages');
const locationsControl = (harness: RouterTestingHarness) => control(harness, 'Locations pages');
const hrefs = (nav: Element | null) =>
  [...(nav?.querySelectorAll('a') ?? [])].map((a) => [text(a), a.getAttribute('href')] as const);
const rowIds = (harness: RouterTestingHarness, section: string) =>
  [...host(harness).querySelectorAll(`#${section} li[id]`)].map((row) => row.id);
const rowNames = (harness: RouterTestingHarness, section: string) =>
  [...host(harness).querySelectorAll(`#${section} li[id] h3`)].map(text);
const list = (harness: RouterTestingHarness, section: string) =>
  host(harness).querySelector(`#${section} ul`);

function activate(nav: Element | null, name: string, { focus = false } = {}): void {
  const link = [...(nav?.querySelectorAll('a') ?? [])].find((a) => text(a) === name);
  expect(link, name).toBeDefined();
  if (focus) link?.focus();
  link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

const range = (from: number, to: number, prefix: string) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const names = (from: number, to: number, noun: string) =>
  range(from, to, '').map((n) => `${noun} ${n.padStart(2, '0')}`);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('the organization page reads its pages from the URL', () => {
  it('asks for the leagues page from leagues and the locations page from locations, and nothing else', async () => {
    await open(`${ORG}?locations=2&page=4&leagues=3&utm_source=x`);
    expect(subscription(LEAGUES).args).toEqual({ slug: PAGED.slug, page: 3 });
    expect(subscription(LOCATIONS).args).toEqual({ slug: PAGED.slug, page: 2 });
  });

  it.each(['0', '2.5', '02', 'abc', '', '-1', '1000'])(
    'asks for page 1 of either list for the value %j',
    async (value) => {
      await open(`${ORG}?leagues=${value}&locations=${value}`);
      expect(subscription(LEAGUES).args).toEqual({ slug: PAGED.slug, page: 1 });
      expect(subscription(LOCATIONS).args).toEqual({ slug: PAGED.slug, page: 1 });
    },
  );

  it('asks for page 1 of a repeated parameter and keeps the other list on its page', async () => {
    await open(`${ORG}?leagues=2&leagues=3&locations=2`);
    expect(subscription(LEAGUES).args).toEqual({ slug: PAGED.slug, page: 1 });
    expect(subscription(LOCATIONS).args).toEqual({ slug: PAGED.slug, page: 2 });
  });

  it.each(['7', '41'])(
    'shows page 1 with the bare canonical when the query answers page 1 for ?leagues=%s',
    async (value) => {
      const harness = await openWith(
        open(`${ORG}?leagues=${value}`),
        pagedResults(PAGED, { leagues: Number(value) }),
      );
      expect(rowIds(harness, 'leagues')).toEqual(range(1, 5, 'league-'));
      expect(canonical()).toBe(`${origin()}${ORG}`);
      expect(
        leaguesControl(harness)?.querySelector('[aria-current="page"]')?.textContent,
      ).toContain('1');
      expect(host(harness).querySelector('main')?.innerHTML).not.toContain(`leagues=${value}`);
    },
  );
});

describe('the organization page on ?leagues=3', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await openWith(open(`${ORG}?leagues=3`), pagedResults(PAGED, { leagues: 3 }));
  });

  it('shows leagues 11 to 15 with ids counted across pages, and locations 1 to 5', () => {
    expect(rowIds(harness, 'leagues')).toEqual(range(11, 15, 'league-'));
    expect(rowNames(harness, 'leagues')).toEqual(names(11, 15, 'League'));
    expect(rowIds(harness, 'locations')).toEqual(range(1, 5, 'location-'));
  });

  it('shows the range, page 3 current, and links that keep the locations page', () => {
    const nav = leaguesControl(harness);
    expect(text(nav?.querySelector('p'))).toBe('11–15 of 26 leagues');
    expect(text(nav?.querySelector('[aria-current="page"]'))).toBe('Page 3');
    expect(hrefs(nav)).toEqual([
      ['Previous page', `${ORG}?leagues=2#leagues`],
      ['Page 1', `${ORG}#leagues`],
      ['Page 2', `${ORG}?leagues=2#leagues`],
      ['Page 3', `${ORG}?leagues=3#leagues`],
      ['Page 4', `${ORG}?leagues=4#leagues`],
      ['Page 6', `${ORG}?leagues=6#leagues`],
      ['Next page', `${ORG}?leagues=4#leagues`],
    ]);
  });

  it('keeps the leagues page in every locations link', () => {
    const nav = locationsControl(harness);
    expect(text(nav?.querySelector('p'))).toBe('1–5 of 14 locations');
    expect(hrefs(nav)).toEqual([
      ['Page 1', `${ORG}?leagues=3#locations`],
      ['Page 2', `${ORG}?leagues=3&locations=2#locations`],
      ['Page 3', `${ORG}?leagues=3&locations=3#locations`],
      ['Next page', `${ORG}?leagues=3&locations=2#locations`],
    ]);
  });

  it('sets the canonical and og:url to the page', () => {
    expect(canonical()).toBe(`${origin()}${ORG}?leagues=3`);
    expect(ogUrl()).toBe(`${origin()}${ORG}?leagues=3`);
  });

  it('keeps the hero counts at the totals', () => {
    expect(text(host(harness).querySelector('main h1')?.parentElement?.nextElementSibling)).toBe(
      'Soccer and softball · 26 leagues at 14 locations',
    );
  });
});

describe('the organization page on the last pages', () => {
  it('shows league 26 and locations 11 to 14, with Next not a link in either control', async () => {
    const harness = await openWith(
      open(`${ORG}?leagues=6&locations=3`),
      pagedResults(PAGED, { leagues: 6, locations: 3 }),
    );
    expect(rowIds(harness, 'leagues')).toEqual(['league-26']);
    expect(rowIds(harness, 'locations')).toEqual(range(11, 14, 'location-'));
    for (const nav of [leaguesControl(harness), locationsControl(harness)]) {
      const next = [...(nav?.querySelectorAll('[aria-disabled="true"]') ?? [])].map(text);
      expect(next).toEqual(['Next page']);
      expect(hrefs(nav).map(([name]) => name)).not.toContain('Next page');
    }
    expect(text(locationsControl(harness)?.querySelector('p'))).toBe('11–14 of 14 locations');
    expect(hrefs(locationsControl(harness))[0]).toEqual([
      'Previous page',
      `${ORG}?leagues=6&locations=2#locations`,
    ]);
    expect(canonical()).toBe(`${origin()}${ORG}?leagues=6&locations=3`);
  });

  it('orders the canonical leagues then locations and drops every other parameter', async () => {
    const harness = await openWith(
      open(`${ORG}?locations=3&leagues=6&utm_source=x`),
      pagedResults(PAGED, { leagues: 6, locations: 3 }),
    );
    expect(canonical()).toBe(`${origin()}${ORG}?leagues=6&locations=3`);
    expect(host(harness).querySelector('main')?.innerHTML).not.toContain('utm_source');
  });
});

describe('the organization page controls from the totals', () => {
  const withRows = (count: number): PublicOrganizationPage => ({
    ...PAGED,
    leagueCount: count,
    locationCount: count,
    sports: count === 0 ? [] : PAGED.sports,
    leagues: PAGED.leagues.slice(0, count),
    locations: PAGED.locations.slice(0, count),
  });

  it('shows no control for 5 leagues and 5 locations', async () => {
    const harness = await openWith(open(), pagedResults(withRows(5)));
    expect(rowIds(harness, 'leagues')).toHaveLength(5);
    expect(rowIds(harness, 'locations')).toHaveLength(5);
    expect(host(harness).querySelector('app-page-control nav')).toBeNull();
  });

  it('shows 2 pages for 6 leagues and 6 locations', async () => {
    const harness = await openWith(open(), pagedResults(withRows(6)));
    for (const nav of [leaguesControl(harness), locationsControl(harness)]) {
      expect(hrefs(nav).filter(([name]) => name.startsWith('Page '))).toHaveLength(2);
    }
  });

  it('shows the empty state and no control for 0 leagues and 0 locations', async () => {
    const harness = await openWith(open(), pagedResults(withRows(0)));
    expect(text(host(harness).querySelector('main h2'))).toBe('No leagues yet');
    expect(host(harness).querySelector('app-page-control')).toBeNull();
    expect(host(harness).querySelector('#locations')).toBeNull();
  });
});

describe('a page change on the organization page', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await openWith(open(), pagedResults(PAGED));
  });

  it('keeps the shown leagues with aria-busy, then swaps them and focuses the Leagues heading', async () => {
    const kept = [subscription(HEADER), subscription(LOCATIONS)];
    const before = subscription(LEAGUES);
    activate(leaguesControl(harness), 'Next page');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe(`${ORG}?leagues=2#leagues`);
    expect(subscription(LEAGUES)).not.toBe(before);
    expect(subscription(LEAGUES).args).toEqual({ slug: PAGED.slug, page: 2 });
    expect([subscription(HEADER), subscription(LOCATIONS)]).toEqual(kept);
    expect(list(harness, 'leagues')?.getAttribute('aria-busy')).toBe('true');
    expect(list(harness, 'locations')?.getAttribute('aria-busy')).toBeNull();
    expect(rowNames(harness, 'leagues')).toEqual(names(1, 5, 'League'));
    expect(text(leaguesControl(harness)?.querySelector('p'))).toBe('1–5 of 26 leagues');
    expect(document.activeElement).not.toBe(host(harness).querySelector('#leagues-heading'));

    emit(pagedResults(PAGED, { leagues: 2 }), [LEAGUES]);
    await settle(harness);
    expect(list(harness, 'leagues')?.getAttribute('aria-busy')).toBeNull();
    expect(rowIds(harness, 'leagues')).toEqual(range(6, 10, 'league-'));
    expect(rowNames(harness, 'leagues')).toEqual(names(6, 10, 'League'));
    expect(text(leaguesControl(harness)?.querySelector('p'))).toBe('6–10 of 26 leagues');
    expect(rowIds(harness, 'locations')).toEqual(range(1, 5, 'location-'));
    expect(document.activeElement).toBe(host(harness).querySelector('#leagues-heading'));
  });

  it('keeps the shown locations with aria-busy, then swaps them and focuses the Locations heading', async () => {
    const kept = [subscription(HEADER), subscription(LEAGUES)];
    activate(locationsControl(harness), 'Next page');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe(`${ORG}?locations=2#locations`);
    expect(subscription(LOCATIONS).args).toEqual({ slug: PAGED.slug, page: 2 });
    expect([subscription(HEADER), subscription(LEAGUES)]).toEqual(kept);
    expect(list(harness, 'locations')?.getAttribute('aria-busy')).toBe('true');
    expect(list(harness, 'leagues')?.getAttribute('aria-busy')).toBeNull();
    expect(rowNames(harness, 'locations')).toEqual(names(1, 5, 'Location'));

    emit(pagedResults(PAGED, { locations: 2 }), [LOCATIONS]);
    await settle(harness);
    expect(list(harness, 'locations')?.getAttribute('aria-busy')).toBeNull();
    expect(rowIds(harness, 'locations')).toEqual(range(6, 10, 'location-'));
    expect(rowNames(harness, 'locations')).toEqual(names(6, 10, 'Location'));
    const heading = host(harness).querySelector('#locations-heading');
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
  });

  it('moves no focus for a live update of either list', async () => {
    const focused = document.activeElement;
    emit(pagedResults({ ...PAGED, leagueCount: 27, locationCount: 15 }), [LEAGUES, LOCATIONS]);
    await settle(harness);
    expect(document.activeElement).toBe(focused);
  });

  it('shows the server-error view with Try again to the requested leagues page when it fails', async () => {
    activate(leaguesControl(harness), 'Next page');
    await settle(harness);
    subscription(LEAGUES).fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
    await settle(harness);
    const main = host(harness).querySelector('main');
    expect(text(main?.querySelector('h1'))).toBe('This page is temporarily unavailable');
    expect(main?.querySelector('a')?.getAttribute('href')).toBe(`${ORG}?leagues=2`);
  });

  it('shows the server-error view with Try again to both requested pages when a locations page fails', async () => {
    await TestBed.inject(Router).navigateByUrl(`${ORG}?leagues=3`);
    await settle(harness);
    emit(pagedResults(PAGED, { leagues: 3 }), [LEAGUES]);
    await settle(harness);
    activate(locationsControl(harness), 'Next page');
    await settle(harness);
    subscription(LOCATIONS).fail(new Error('down'));
    await settle(harness);
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(
      `${ORG}?leagues=3&locations=2`,
    );
  });
});

describe('focus after a page change whose query fails on the organization page', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await openWith(open(), pagedResults(PAGED));
  });

  it.each([
    ['Leagues pages', LEAGUES],
    ['Locations pages', LOCATIONS],
  ])('moves focus from Next in %s to the server-error view h1', async (label, failing) => {
    activate(control(harness, label), 'Next page', { focus: true });
    await settle(harness);
    subscription(failing).fail(new Error('down'));
    await settle(harness);
    const heading = host(harness).querySelector('main h1');
    expect(text(heading)).toBe('This page is temporarily unavailable');
    expect(document.activeElement).toBe(heading);
  });
});

describe('a shown page that the list shrinks past', () => {
  it('shows page 1 with page 1 current and leaves the URL alone', async () => {
    const harness = await openWith(open(`${ORG}?leagues=3`), pagedResults(PAGED, { leagues: 3 }));
    expect(rowIds(harness, 'leagues')).toEqual(range(11, 15, 'league-'));
    subscription(LEAGUES).emit(listPage(PAGED.leagues.slice(0, 8), 3));
    await settle(harness);
    expect(rowIds(harness, 'leagues')).toEqual(range(1, 5, 'league-'));
    expect(rowNames(harness, 'leagues')).toEqual(names(1, 5, 'League'));
    expect(text(leaguesControl(harness)?.querySelector('[aria-current="page"]'))).toBe('Page 1');
    expect(text(leaguesControl(harness)?.querySelector('p'))).toBe('1–5 of 8 leagues');
    expect(TestBed.inject(Router).url).toBe(`${ORG}?leagues=3`);
    expect(canonical()).toBe(`${origin()}${ORG}`);
  });
});
