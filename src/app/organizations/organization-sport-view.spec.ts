import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import { LIST_PAGE_SIZE } from '../core/list-page';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import type { PublicOrganizationPage } from './organization-path';
import { GULF_COAST, queryResults, sportQueryResults } from './testing/pages';

const HEADER = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';
const LOCATIONS = 'organizations:listPublicLocations';
const ORG = '/organizations/gulf-coast-sport-social';
const SOCCER = `${ORG}/sports/soccer`;

let client: FakeConvexClient;

async function open(url = SOCCER): Promise<RouterTestingHarness> {
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

function subscriptions(name: string): FakeSubscription[] {
  return client.activeSubscriptions.filter((s) => s.name === name);
}

function subscription(name = HEADER): FakeSubscription {
  const active = subscriptions(name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

function emit(results: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const head = () => TestBed.inject(DOCUMENT).head;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
const metaContent = (property: string) =>
  head().querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;

const leaguesSection = (harness: RouterTestingHarness) =>
  host(harness).querySelector('section[aria-labelledby="leagues-heading"]');
const locationsSection = (harness: RouterTestingHarness) =>
  host(harness).querySelector('section[aria-labelledby="locations-heading"]');

const SOCCER_LEAGUES = LIST_PAGE_SIZE + 2;

const TWO_SOCCER_PAGES: PublicOrganizationPage = {
  ...GULF_COAST,
  leagueCount: 10,
  sports: GULF_COAST.sports.map((sport) =>
    sport.key === 'soccer' ? { ...sport, leagueCount: SOCCER_LEAGUES } : sport,
  ),
  leagues: Array.from({ length: SOCCER_LEAGUES }, (_, i) => ({
    name: `Soccer League ${i + 1}`,
    slug: `soccer-league-${i + 1}`,
    sportName: 'Soccer',
    locationNames: ['Bayside Athletic Complex'],
  })),
};

function pageTwo(): Record<string, unknown> {
  const results = sportQueryResults(TWO_SOCCER_PAGES, 'soccer');
  return {
    ...results,
    [LEAGUES]: {
      rows: TWO_SOCCER_PAGES.leagues.slice(LIST_PAGE_SIZE),
      page: 2,
      pageCount: 2,
      total: SOCCER_LEAGUES,
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('the sport view queries', () => {
  it("asks for the organization, page 1 of the sport's leagues and locations, and its open seasons", async () => {
    await open();
    expect(
      client.activeSubscriptions
        .map(({ name, args }) => ({ name, args }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ).toEqual([
      { name: HEADER, args: { slug: 'gulf-coast-sport-social' } },
      { name: LEAGUES, args: { slug: 'gulf-coast-sport-social', page: 1, sport: 'soccer' } },
      { name: LOCATIONS, args: { slug: 'gulf-coast-sport-social', page: 1, sport: 'soccer' } },
      {
        name: 'seasons:listOpenForOrganization',
        args: { orgSlug: 'gulf-coast-sport-social', sport: 'soccer' },
      },
    ]);
  });

  it('reads the page from the page parameter alone', async () => {
    await open(`${SOCCER}?page=2&ott=SECRET`);
    expect(subscription(LEAGUES).args).toEqual({
      slug: 'gulf-coast-sport-social',
      page: 2,
      sport: 'soccer',
    });
    expect(subscription(LOCATIONS).args).toMatchObject({ page: 1 });
  });

  it.each(['?page=0', '?page=abc', '?page=2&page=3', '?page=-1', '?page=1000'])(
    'asks for page 1 for %s',
    async (query) => {
      await open(`${SOCCER}${query}`);
      expect(subscription(LEAGUES).args).toMatchObject({ page: 1 });
    },
  );

  it('asks nothing for a segment that names no sport', async () => {
    const harness = await open(`${ORG}/sports/curling`);
    await settle(harness);
    expect(client.subscriptions).toHaveLength(0);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
  });

  it('asks nothing for the camel-case key of a sport', async () => {
    await open(`${ORG}/sports/beachVolleyball`);
    expect(client.subscriptions).toHaveLength(0);
  });

  it('does not read the page parameter on the organization page', async () => {
    await open(`${ORG}?page=3`);
    expect(subscription(LEAGUES).args).toEqual({ slug: 'gulf-coast-sport-social', page: 1 });
  });
});

describe('the sport view populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit(sportQueryResults(GULF_COAST, 'soccer'));
    await settle(harness);
  });

  it('keeps the hero of the whole organization', () => {
    const h1 = host(harness).querySelector('main h1');
    expect(text(h1)).toBe('Gulf Coast Sport & Social');
    expect(text(h1?.parentElement?.nextElementSibling)).toBe(
      'Beach volleyball, soccer, and softball · 5 leagues at 3 locations',
    );
  });

  it('marks the Soccer chip current and no other', () => {
    const links = [...host(harness).querySelectorAll('nav[aria-label="Sports"] a')];
    expect(links.map((a) => [text(a), a.getAttribute('aria-current')])).toEqual([
      ['All sports 5 leagues', null],
      ['Beach volleyball 2 leagues', null],
      ['Soccer 2 leagues', 'page'],
      ['Softball 1 league', null],
    ]);
  });

  it('titles the leagues section by the sport and lists only its leagues', () => {
    const section = leaguesSection(harness);
    expect(text(section?.querySelector('h2'))).toBe('Soccer leagues');
    expect(text(section?.querySelector('h2')?.nextElementSibling)).toBe('2 leagues');
    expect([...(section?.querySelectorAll('h3') ?? [])].map(text)).toEqual([
      'Coed 7v7 Rec',
      "Men's Over-30 11v11",
    ]);
  });

  it('lists only the locations where the sport is played, with all their sports', () => {
    const rows = [...(locationsSection(harness)?.querySelectorAll('li') ?? [])];
    expect(rows.map((row) => [...row.querySelectorAll('h3, p')].map(text))).toEqual([
      ['Bayside Athletic Complex', '4410 Ocean Dr, Corpus Christi, TX 78412', 'Soccer, softball'],
    ]);
  });

  it('shows no page control for 2 leagues', () => {
    expect(host(harness).querySelector('app-page-control nav')).toBeNull();
  });

  it('sets the title, the og tags, and the canonical from the results', () => {
    const origin = TestBed.inject(DOCUMENT).location.origin;
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Soccer | Gulf Coast Sport & Social | Omni League',
    );
    expect(metaContent('og:title')).toBe('Soccer | Gulf Coast Sport & Social');
    expect(metaContent('og:url')).toBe(`${origin}${SOCCER}`);
    expect(canonical()).toBe(`${origin}${SOCCER}`);
  });

  it('removes its tags when the visitor leaves', async () => {
    await harness.navigateByUrl('/elsewhere');
    expect(canonical()).toBeNull();
    expect(metaContent('og:url')).toBeNull();
  });
});

describe('the sport view not found and failures', () => {
  it('shows the not-found view for an unknown organization', async () => {
    const harness = await open();
    subscription(HEADER).emit(null);
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(host(harness).querySelector('nav[aria-label="Sports"]')).toBeNull();
    expect(canonical()).toBeNull();
  });

  it('shows the not-found view for a sport the organization has no published league in', async () => {
    const harness = await open(`${ORG}/sports/softball`);
    const header = queryResults(GULF_COAST)[HEADER] as PublicOrganizationPage;
    subscription(HEADER).emit({
      ...header,
      sports: header.sports.filter((sport) => sport.key !== 'softball'),
    });
    subscription(LEAGUES).emit({ rows: [], page: 1, pageCount: 0, total: 0 });
    subscription(LOCATIONS).emit({ rows: [], page: 1, pageCount: 0, total: 0 });
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
  });

  it('shows the server-error view with a Try again link to the sport view when a query fails', async () => {
    const harness = await open(`${SOCCER}?page=2&ott=SECRET`);
    subscription(LEAGUES).fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
    await settle(harness);
    const main = host(harness).querySelector('main');
    expect(text(main?.querySelector('h1'))).toBe('This page is temporarily unavailable');
    expect(main?.textContent).not.toContain('internal-db');
    expect(main?.querySelector('a')?.getAttribute('href')).toBe(`${SOCCER}?page=2`);
  });

  it('shows the page skeleton until the organization arrives, then the hero with the lists as a skeleton until both lists arrive', async () => {
    const harness = await open();
    const results = sportQueryResults(GULF_COAST, 'soccer');
    expect(host(harness).querySelector('app-organization-skeleton')).not.toBeNull();
    subscription(HEADER).emit(results[HEADER]);
    subscription(LEAGUES).emit(results[LEAGUES]);
    await settle(harness);
    expect(host(harness).querySelector('app-organization-skeleton')).toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
    expect(text(leaguesSection(harness)?.querySelector('h2'))).toBe('Soccer leagues');
    expect(text(locationsSection(harness)?.querySelector('[role="status"]'))).toBe(
      'Loading the locations.',
    );
    expect(leaguesSection(harness)?.querySelector('h3')?.textContent).toContain('Coed 7v7 Rec');
    subscription(LOCATIONS).emit(results[LOCATIONS]);
    await settle(harness);
    expect(locationsSection(harness)?.querySelector('[role="status"]')).toBeNull();
    expect([...(locationsSection(harness)?.querySelectorAll('h3') ?? [])].map(text)).toEqual([
      'Bayside Athletic Complex',
    ]);
  });
});

describe('the sport view with several pages', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit(sportQueryResults(TWO_SOCCER_PAGES, 'soccer'));
    await settle(harness);
  });

  it('shows the range and ?page=N links under the leagues', () => {
    const nav = host(harness).querySelector('nav[aria-label="Leagues pages"]');
    expect(text(nav?.querySelector('p'))).toBe(`1–${LIST_PAGE_SIZE} of ${SOCCER_LEAGUES} leagues`);
    expect([...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
      `${SOCCER}#leagues`,
      `${SOCCER}?page=2#leagues`,
      `${SOCCER}?page=2#leagues`,
    ]);
    expect(text(leaguesSection(harness)?.querySelector('h2')?.nextElementSibling)).toBe(
      `${SOCCER_LEAGUES} leagues`,
    );
  });

  it('puts the page in the canonical only past page 1', async () => {
    const origin = TestBed.inject(DOCUMENT).location.origin;
    expect(canonical()).toBe(`${origin}${SOCCER}`);
    await TestBed.inject(Router).navigateByUrl(`${SOCCER}?page=2`);
    await settle(harness);
    subscription(LEAGUES).emit(pageTwo()[LEAGUES]);
    await settle(harness);
    expect(canonical()).toBe(`${origin}${SOCCER}?page=2`);
    expect(metaContent('og:url')).toBe(`${origin}${SOCCER}?page=2`);
  });

  it('keeps the shown rows with aria-busy while the next page loads, then moves focus to the heading', async () => {
    const link = host(harness).querySelector<HTMLAnchorElement>(
      'nav[aria-label="Leagues pages"] a[href*="page=2"]',
    );
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await settle(harness);
    const list = () => leaguesSection(harness)?.querySelector('ul');
    expect(list()?.getAttribute('aria-busy')).toBe('true');
    expect([...(list()?.querySelectorAll('h3') ?? [])].map(text)).toEqual(
      TWO_SOCCER_PAGES.leagues.slice(0, LIST_PAGE_SIZE).map((league) => league.name),
    );
    subscription(LEAGUES).emit(pageTwo()[LEAGUES]);
    await settle(harness);
    expect(list()?.getAttribute('aria-busy')).toBeNull();
    expect([...(list()?.querySelectorAll('h3') ?? [])].map(text)).toEqual([
      'Soccer League 6',
      'Soccer League 7',
    ]);
    expect(document.activeElement).toBe(leaguesSection(harness)?.querySelector('h2'));
  });

  it('keeps the organization and locations subscriptions open across a page change', async () => {
    const before = [subscription(HEADER), subscription(LOCATIONS)];
    await TestBed.inject(Router).navigateByUrl(`${SOCCER}?page=2`);
    await settle(harness);
    expect([subscription(HEADER), subscription(LOCATIONS)]).toEqual(before);
  });
});

describe('moving between the chips', () => {
  it("never keeps another sport's leagues while the next sport loads", async () => {
    const harness = await open();
    emit(sportQueryResults(GULF_COAST, 'soccer'));
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl(`${ORG}/sports/softball`);
    await settle(harness);
    expect(host(harness).querySelector('app-organization-skeleton')).toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Sport & Social');
    expect(
      host(harness).querySelector('nav[aria-label="Sports"] [aria-current="page"]')?.textContent,
    ).toContain('Softball');
    expect(text(leaguesSection(harness)?.querySelector('h2'))).toBe('Softball leagues');
    expect(text(leaguesSection(harness)?.querySelector('[role="status"]'))).toBe(
      'Loading the leagues.',
    );
    expect(host(harness).textContent).not.toContain('Coed 7v7 Rec');
    emit(sportQueryResults(GULF_COAST, 'softball'));
    await settle(harness);
    expect(text(leaguesSection(harness)?.querySelector('h2'))).toBe('Softball leagues');
    expect([...(leaguesSection(harness)?.querySelectorAll('h3') ?? [])].map(text)).toEqual([
      'Wednesday Coed Slow-Pitch',
    ]);
    expect(
      host(harness).querySelector('nav[aria-label="Sports"] [aria-current="page"]')?.textContent,
    ).toContain('Softball');
  });

  it('shows the whole organization again from All sports', async () => {
    const harness = await open();
    emit(sportQueryResults(GULF_COAST, 'soccer'));
    await settle(harness);
    const all = host(harness).querySelector<HTMLAnchorElement>('nav[aria-label="Sports"] a');
    expect(all?.getAttribute('href')).toBe(ORG);
    await harness.navigateByUrl(ORG);
    emit(queryResults(GULF_COAST));
    await settle(harness);
    expect(text(leaguesSection(harness)?.querySelector('h2'))).toBe('Leagues');
    expect(leaguesSection(harness)?.querySelectorAll('li')).toHaveLength(5);
    expect(
      host(harness).querySelector('nav[aria-label="Sports"] [aria-current="page"]')?.textContent,
    ).toContain('All sports');
  });
});
