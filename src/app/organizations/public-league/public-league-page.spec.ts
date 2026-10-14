import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicLeaguePage } from './public-league-page';
import {
  leagueQueryResults,
  NO_SEASONS,
  SEASONS,
  seasonsPage,
  SUNDAY_4S,
} from './testing/league-data';

const ORG = 'organizations:getPublicPage';
const LEAGUE = 'leagues:getPublicPage';
const SEASONS_QUERY = 'seasons:listPublic';
const PATH = '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s';

let client: FakeConvexClient;

async function open(url = PATH): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug/leagues/:leagueSlug', component: PublicLeaguePage },
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

function emit(results: Record<string, unknown> = leagueQueryResults()): void {
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
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
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('PublicLeaguePage queries', () => {
  it("asks for the organization, the league, and page 1 of its seasons with the route's slugs only", async () => {
    await open(`${PATH}?ott=SECRET&utm_source=x#seasons`);
    expect(
      client.activeSubscriptions
        .map(({ name, args }) => ({ name, args }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ).toEqual([
      {
        name: LEAGUE,
        args: { orgSlug: 'gulf-coast-sport-social', leagueSlug: 'sunday-reverse-coed-4s' },
      },
      { name: ORG, args: { slug: 'gulf-coast-sport-social' } },
      {
        name: SEASONS_QUERY,
        args: { orgSlug: 'gulf-coast-sport-social', leagueSlug: 'sunday-reverse-coed-4s', page: 1 },
      },
    ]);
  });

  it.each([
    ['?page=2', 2],
    ['?page=40', 40],
    ['?page=0', 1],
    ['?page=abc', 1],
    ['?page=2.5', 1],
    ['?page=02', 1],
    ['?page=1000', 1],
    ['?page=', 1],
    ['?page=2&page=3', 1],
    ['?page=2&page=abc', 1],
    ['?other=2', 1],
  ])('%s asks for page %i', async (query, page) => {
    await open(`${PATH}${query}`);
    expect(subscription(SEASONS_QUERY).args).toMatchObject({ page });
  });

  it('shows nothing but the layout until all three results have arrived', async () => {
    const harness = await open();
    const results = leagueQueryResults();
    subscription(ORG).emit(results[ORG]);
    subscription(LEAGUE).emit(results[LEAGUE]);
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('main nav')).toBeNull();
    subscription(SEASONS_QUERY).emit(results[SEASONS_QUERY]);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Sunday Reverse Coed 4s');
  });
});

describe('PublicLeaguePage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb organization, sport, league, and the league as the only h1', () => {
    const main = host(harness).querySelector('main');
    const crumbs = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] li') ?? [])];
    const links = crumbs.filter((li) => li.querySelector('a')).map((li) => li.querySelector('a'));
    expect(links.map(text)).toEqual(['Gulf Coast Sport & Social', 'Sunday Reverse Coed 4s']);
    expect(links.map((a) => a?.getAttribute('href'))).toEqual([
      '/organizations/gulf-coast-sport-social',
      PATH,
    ]);
    expect(links.map((a) => a?.getAttribute('aria-current'))).toEqual([null, 'page']);
    expect(text(crumbs[2])).toBe('Beach volleyball');
    expect(crumbs[2].querySelector('a')).toBeNull();
    expect(crumbs.filter((li) => li.getAttribute('aria-hidden') === 'true')).toHaveLength(2);
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Sunday Reverse Coed 4s');
  });

  it('shows the sport badge and the locations, the location read after "Location:"', () => {
    const main = host(harness).querySelector('main');
    const h1 = main?.querySelector('h1');
    const row = h1?.nextElementSibling;
    expect(text(row?.querySelector('[data-slot="badge"]'))).toBe('Beach volleyball');
    expect(text(row?.querySelector('p'))).toBe('Location: North Beach Sand Courts');
  });

  it('labels several locations as "Locations:" and lists them in order', async () => {
    emit(
      leagueQueryResults({
        league: {
          ...SUNDAY_4S,
          locationNames: ['Bayside Athletic Complex', 'North Beach Sand Courts'],
        },
      }),
    );
    await settle(harness);
    expect(
      text(host(harness).querySelector('main h1')?.nextElementSibling?.querySelector('p')),
    ).toBe('Locations: Bayside Athletic Complex, North Beach Sand Courts');
  });

  it('lists the seasons newest first, each name a link to its season page, with dates and format', () => {
    const panel = host(harness).querySelector('section#seasons');
    expect(panel?.getAttribute('aria-labelledby')).toBe('seasons-heading');
    expect(text(panel?.querySelector('h2'))).toBe('Seasons');
    const rows = [...(panel?.querySelectorAll(':scope > ul > li') ?? [])];
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => text(row.querySelector('h3')))).toEqual(
      SEASONS.slice(0, 5).map((season) => season.name),
    );
    expect(rows.map((row) => row.querySelector('h3 a')?.getAttribute('href'))).toEqual(
      SEASONS.slice(0, 5).map((season) => `${PATH}/seasons/${season.slug}`),
    );
    expect(text(rows[0].querySelector('p'))).toBe('Dates: Jun 6 – Aug 29, 2027');
    expect(text(rows[2].querySelector('p'))).toBe('Dates: Sep 13 – Nov 15, 2026');
    expect(text(rows[0].querySelector('[data-slot="badge"]'))).toBe('4v4');
  });

  it('shows the range and the numbered control of page 1 of 2', () => {
    const nav = host(harness).querySelector('nav[aria-label="Seasons pages"]');
    expect(text(nav?.querySelector('p'))).toBe('1–5 of 7 seasons');
    expect(nav?.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      `${PATH}#seasons`,
    );
    expect([...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
      `${PATH}#seasons`,
      `${PATH}?page=2#seasons`,
      `${PATH}?page=2#seasons`,
    ]);
  });

  it('sets the title and the Open Graph tags from the results, with the bare path as canonical on page 1', () => {
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Sunday Reverse Coed 4s | Gulf Coast Sport & Social | Omni League',
    );
    expect(metaContent('og:title')).toBe('Sunday Reverse Coed 4s');
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Seasons of Sunday Reverse Coed 4s from Gulf Coast Sport & Social on Omni League.',
    );
    expect(metaContent('og:url')).toBe(`${window.location.origin}${PATH}`);
    expect(canonical()).toBe(`${window.location.origin}${PATH}`);
  });

  it('renders in the public layout: top bar and footer, no organization sidebar and no menu button', () => {
    const root = host(harness);
    expect(root.querySelector('app-public-layout')).not.toBeNull();
    expect(root.querySelector('app-shell')).toBeNull();
    expect(root.querySelectorAll('header')).toHaveLength(1);
    expect(root.querySelectorAll('footer')).toHaveLength(1);
    const names = [...root.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'));
    expect(names).toContain('Footer');
    expect(names).not.toContain('Gulf Coast Sport & Social');
    expect(root.querySelector('button[aria-label="Open navigation"]')).toBeNull();
  });

  it('names a sport the organization does not list in the breadcrumb, without a link', async () => {
    emit(leagueQueryResults({ league: { ...SUNDAY_4S, sportName: 'Curling' } }));
    await settle(harness);
    const crumbs = host(harness).querySelector('nav[aria-label="Breadcrumb"]');
    expect(text(crumbs)).toContain('Curling');
    expect([...(crumbs?.querySelectorAll('a') ?? [])].map(text)).not.toContain('Curling');
  });
});

describe('PublicLeaguePage with no published season', () => {
  it('shows the empty state in the Seasons panel and no control', async () => {
    const harness = await open();
    emit(leagueQueryResults({ seasons: NO_SEASONS }));
    await settle(harness);
    const panel = host(harness).querySelector('section#seasons');
    expect(text(panel?.querySelector('h2'))).toBe('Seasons');
    expect(text(panel)).toContain('No seasons yet');
    expect(text(panel)).toContain(
      'Seasons of this league will be listed here once they’re published.',
    );
    expect(panel?.querySelectorAll('li')).toHaveLength(0);
    expect(host(harness).querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
  });

  it('shows no control for 5 seasons and one for 6', async () => {
    const harness = await open();
    emit(leagueQueryResults({ seasons: seasonsPage(1, 5) }));
    await settle(harness);
    expect(host(harness).querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
    emit(leagueQueryResults({ seasons: { ...seasonsPage(1, 6), total: 6 } }));
    await settle(harness);
    expect(host(harness).querySelector('nav[aria-label="Seasons pages"]')).not.toBeNull();
  });
});

describe('PublicLeaguePage page 2', () => {
  it('shows seasons 6 and 7, the range, and the canonical and og:url with ?page=2', async () => {
    const harness = await open(`${PATH}?page=2&utm_source=x`);
    emit(leagueQueryResults({ page: 2 }));
    await settle(harness);
    const rows = [...host(harness).querySelectorAll('section#seasons > ul > li')];
    expect(rows.map((row) => text(row.querySelector('h3')))).toEqual(['Fall 2025', 'Summer 2025']);
    expect(text(host(harness).querySelector('nav[aria-label="Seasons pages"] p'))).toBe(
      '6–7 of 7 seasons',
    );
    expect(canonical()).toBe(`${window.location.origin}${PATH}?page=2`);
    expect(metaContent('og:url')).toBe(`${window.location.origin}${PATH}?page=2`);
    expect(canonical()).not.toContain('utm_source');
  });

  it('serves page 1 when the query says so, and its canonical is the bare path', async () => {
    const harness = await open(`${PATH}?page=9`);
    emit(leagueQueryResults({ seasons: seasonsPage(1) }));
    await settle(harness);
    expect(
      host(harness).querySelector('nav[aria-label="Seasons pages"] a[aria-current="page"]')
        ?.textContent,
    ).toContain('1');
    expect(canonical()).toBe(`${window.location.origin}${PATH}`);
  });
});

describe('PublicLeaguePage not found and errors', () => {
  it('shows the not-found view in the public layout for a null league', async () => {
    const harness = await open();
    emit(leagueQueryResults({ league: null, seasons: NO_SEASONS }));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(host(harness).querySelector('main nav')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
    expect(canonical()).toBeNull();
    expect(metaContent('og:title')).toBeNull();
  });

  it('shows the not-found view for an unknown organization', async () => {
    const harness = await open();
    emit(leagueQueryResults({ organization: null, league: null, seasons: NO_SEASONS }));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
  });

  it.each([ORG, LEAGUE, SEASONS_QUERY])(
    'shows the server-error view when %s fails, with a retry link to the page asked for',
    async (failing) => {
      const harness = await open(`${PATH}?page=3&ott=SECRET`);
      subscription(failing).fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
      for (const [name, value] of Object.entries(leagueQueryResults({ page: 3 }))) {
        if (name !== failing) subscription(name).emit(value);
      }
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe(
        'This page is temporarily unavailable',
      );
      expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(`${PATH}?page=3`);
      expect(host(harness).querySelector('main nav')).toBeNull();
      expect(host(harness).textContent).not.toContain('internal-db');
      expect(host(harness).textContent).not.toContain('SECRET');
    },
  );

  it('retries to the bare path when page 1 was asked for', async () => {
    const harness = await open(`${PATH}?ott=SECRET`);
    subscription(LEAGUE).fail(new Error('down'));
    await settle(harness);
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(PATH);
  });
});

describe('PublicLeaguePage page changes', () => {
  async function onPage1(): Promise<RouterTestingHarness> {
    const harness = await open();
    emit();
    await settle(harness);
    return harness;
  }

  const seasonRows = (harness: RouterTestingHarness) =>
    [...host(harness).querySelectorAll('section#seasons > ul > li h3')].map(text);

  it('keeps the old rows, range, and control with aria-busy while the next page loads, then swaps them and moves focus to the heading', async () => {
    const harness = await onPage1();
    const next = host(harness).querySelector<HTMLAnchorElement>(
      'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
    )!;
    next.click();
    await settle(harness);
    const subscriptions = client.activeSubscriptions.filter((s) => s.name === SEASONS_QUERY);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].args).toMatchObject({ page: 2 });
    expect(seasonRows(harness)).toEqual(SEASONS.slice(0, 5).map((s) => s.name));
    expect(host(harness).querySelector('section#seasons ul')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(text(host(harness).querySelector('nav[aria-label="Seasons pages"] p'))).toBe(
      '1–5 of 7 seasons',
    );
    expect(host(harness).ownerDocument.activeElement?.id).not.toBe('seasons-heading');

    subscriptions[0].emit(seasonsPage(2));
    await settle(harness);
    expect(seasonRows(harness)).toEqual(['Fall 2025', 'Summer 2025']);
    expect(host(harness).querySelector('section#seasons ul')?.getAttribute('aria-busy')).toBeNull();
    expect(text(host(harness).querySelector('nav[aria-label="Seasons pages"] p'))).toBe(
      '6–7 of 7 seasons',
    );
    expect(host(harness).ownerDocument.activeElement?.id).toBe('seasons-heading');
    expect(TestBed.inject(Router).url).toBe(`${PATH}?page=2#seasons`);
  });

  it('keeps the league and organization subscriptions open across a page change', async () => {
    const harness = await onPage1();
    const before = client.subscriptions.filter((s) => s.name !== SEASONS_QUERY);
    host(harness)
      .querySelector<HTMLAnchorElement>(
        'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
      )!
      .click();
    await settle(harness);
    expect(client.subscriptions.filter((s) => s.name !== SEASONS_QUERY)).toEqual(before);
    expect(before.every((s) => s.active)).toBe(true);
  });

  it('a live update to the shown page does not move focus', async () => {
    const harness = await onPage1();
    const link = host(harness).querySelector<HTMLAnchorElement>(
      'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
    )!;
    link.focus();
    subscription(SEASONS_QUERY).emit({ ...seasonsPage(1, 8), total: 8 });
    await settle(harness);
    expect(host(harness).ownerDocument.activeElement).toBe(link);
  });

  it('a Ctrl-click on a page link, then a live update of the shown page, does not move focus', async () => {
    const harness = await onPage1();
    const link = host(harness).querySelector<HTMLAnchorElement>(
      'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
    )!;
    link.focus();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    await settle(harness);
    subscription(SEASONS_QUERY).emit({ ...seasonsPage(1, 8), total: 8 });
    await settle(harness);
    expect(host(harness).ownerDocument.activeElement).toBe(link);
    expect(host(harness).ownerDocument.activeElement?.id).not.toBe('seasons-heading');
  });

  it('Back to the earlier page changes the rows and does not move focus', async () => {
    const harness = await onPage1();
    host(harness)
      .querySelector<HTMLAnchorElement>(
        'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
      )!
      .click();
    await settle(harness);
    subscription(SEASONS_QUERY).emit(seasonsPage(2));
    await settle(harness);
    (host(harness).ownerDocument.activeElement as HTMLElement | null)?.blur();
    await TestBed.inject(Router).navigateByUrl(PATH);
    await settle(harness);
    subscription(SEASONS_QUERY).emit(seasonsPage(1));
    await settle(harness);
    expect(seasonRows(harness)[0]).toBe('Summer 2027');
    expect(host(harness).ownerDocument.activeElement?.id).not.toBe('seasons-heading');
  });

  it('shows page 1 when the shown page’s result changes to page 1 (the list shrank), and leaves the URL alone', async () => {
    const harness = await open(`${PATH}?page=2`);
    emit(leagueQueryResults({ page: 2 }));
    await settle(harness);
    subscription(SEASONS_QUERY).emit({ ...seasonsPage(1, 3), total: 3 });
    await settle(harness);
    expect(seasonRows(harness)).toEqual(SEASONS.slice(0, 5).map((s) => s.name));
    expect(host(harness).querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`${PATH}?page=2`);
  });

  it('shows the server-error view with its retry link when the new page’s subscription fails', async () => {
    const harness = await onPage1();
    host(harness)
      .querySelector<HTMLAnchorElement>(
        'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
      )!
      .click();
    await settle(harness);
    subscription(SEASONS_QUERY).fail(new Error('boom'));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'This page is temporarily unavailable',
    );
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(`${PATH}?page=2`);
  });
});
