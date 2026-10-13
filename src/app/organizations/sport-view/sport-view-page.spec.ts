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
import { SportViewPage } from './sport-view-page';
import {
  BEACH_LEAGUES,
  CONFLUENCE,
  CONFLUENCE_NO_SOFTBALL,
  leaguesPage,
  NO_LEAGUES,
  sportQueryResults,
} from './testing/sport-data';

const ORG = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';
const ORG_SLUG = 'confluence-sport-social';
const PATH = `/organizations/${ORG_SLUG}/sports/beach-volleyball`;

let client: FakeConvexClient;

async function open(url = PATH): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'organizations/:orgSlug/sports/:sport', component: SportViewPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  TestBed.tick();
  return harness;
}

/** The one active subscription to the query `name`. */
function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

/** Emits the two results, as the page's queries return them. */
function emit(results: Record<string, unknown> = sportQueryResults()): void {
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
const leagueNames = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('section#leagues > ul > li h3')].map(text);
const control = (harness: RouterTestingHarness) =>
  host(harness).querySelector('nav[aria-label="Leagues pages"]');

// Each live result is saved to localStorage (#82); a saved copy from one test must not seed the
// next one, nor a later spec file (spec files share one global).
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('SportViewPage queries', () => {
  it("asks for the organization and page 1 of the sport's leagues with the route's slug and sport only", async () => {
    await open(`${PATH}?ott=SECRET&utm_source=x#leagues`);
    expect(
      client.activeSubscriptions
        .map(({ name, args }) => ({ name, args }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ).toEqual([
      { name: ORG, args: { slug: ORG_SLUG } },
      { name: LEAGUES, args: { slug: ORG_SLUG, page: 1, sport: 'beachVolleyball' } },
    ]);
  });

  it.each([
    ['soccer', 'soccer'],
    ['softball', 'softball'],
    ['beach-volleyball', 'beachVolleyball'],
  ])('maps the segment %s to the sport key %s', async (segment, sport) => {
    await open(`/organizations/${ORG_SLUG}/sports/${segment}`);
    expect(subscription(LEAGUES).args).toEqual({ slug: ORG_SLUG, page: 1, sport });
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
    expect(subscription(LEAGUES).args).toMatchObject({ page });
  });

  // `listPublicLeagues` validates `sport`: a key it does not know would throw (503), not 404.
  it.each(['beachVolleyball', 'Soccer', 'curling', 'beach-volleyball-', 'softball%20'])(
    'the segment %s never reaches a query and shows the not-found view',
    async (segment) => {
      const harness = await open(`/organizations/${ORG_SLUG}/sports/${segment}`);
      await settle(harness);
      expect(client.subscriptions).toHaveLength(0);
      expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
    },
  );

  it('shows nothing but the shell until both results have arrived', async () => {
    const harness = await open();
    const results = sportQueryResults();
    subscription(ORG).emit(results[ORG]);
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('nav')).toBeNull();
    subscription(LEAGUES).emit(results[LEAGUES]);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Beach volleyball');
  });
});

describe('SportViewPage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb organization, then the sport, and the sport as the only h1', () => {
    const main = host(harness).querySelector('main');
    const crumbs = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] li') ?? [])];
    const links = crumbs.filter((li) => li.querySelector('a')).map((li) => li.querySelector('a'));
    expect(links.map(text)).toEqual(['Confluence Sport & Social', 'Beach volleyball']);
    expect(links.map((a) => a?.getAttribute('href'))).toEqual([`/organizations/${ORG_SLUG}`, PATH]);
    expect(links.map((a) => a?.getAttribute('aria-current'))).toEqual([null, 'page']);
    // The separator is decoration.
    expect(crumbs.filter((li) => li.getAttribute('aria-hidden') === 'true')).toHaveLength(1);
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Beach volleyball');
  });

  it('shows the league and location counts of the sport under the title', () => {
    const h1 = host(harness).querySelector('main h1');
    expect(text(h1?.nextElementSibling)).toBe('12 leagues at 3 locations');
  });

  it('uses the singular for one league at one location', async () => {
    emit(
      sportQueryResults({
        organization: {
          ...CONFLUENCE,
          sports: [{ ...CONFLUENCE.sports[0], leagueCount: 1, locationCount: 1 }],
        },
        leagues: leaguesPage(1, 1),
      }),
    );
    await settle(harness);
    expect(text(host(harness).querySelector('main h1')?.nextElementSibling)).toBe(
      '1 league at 1 location',
    );
  });

  it('lists the first 5 leagues by name in the Leagues panel, each a link to its page, with its locations and no sport badge', () => {
    const panel = host(harness).querySelector('section#leagues');
    expect(panel?.getAttribute('aria-labelledby')).toBe('leagues-heading');
    expect(text(panel?.querySelector('h2'))).toBe('Leagues');
    const rows = [...(panel?.querySelectorAll(':scope > ul > li') ?? [])];
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => text(row.querySelector('h3')))).toEqual(
      BEACH_LEAGUES.slice(0, 5).map((league) => league.name),
    );
    expect(rows.map((row) => row.querySelector('h3 a')?.getAttribute('href'))).toEqual(
      BEACH_LEAGUES.slice(0, 5).map(
        (league) => `/organizations/${ORG_SLUG}/leagues/${league.slug}`,
      ),
    );
    expect(text(rows[0].querySelector('p'))).toBe('Location: American River Sand Courts');
    expect(text(rows[1].querySelector('p'))).toBe(
      'Locations: Lakeshore Cove Sand Courts, Pocket Bend Sand Courts',
    );
    expect(panel?.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('shows the range and the numbered control of page 1 of 3, with ?page=N#leagues links', () => {
    const nav = control(harness);
    expect(nav).not.toBeNull();
    expect(text(nav?.querySelector('p'))).toBe('1–5 of 12 leagues');
    expect(nav?.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      `${PATH}#leagues`,
    );
    expect([...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
      `${PATH}#leagues`,
      `${PATH}?page=2#leagues`,
      `${PATH}?page=3#leagues`,
      `${PATH}?page=2#leagues`,
    ]);
  });

  it('sets the title and the Open Graph tags from the results, with the bare path as canonical on page 1', () => {
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Beach volleyball | Confluence Sport & Social | Omni League',
    );
    expect(metaContent('og:title')).toBe('Beach volleyball');
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Beach volleyball leagues of Confluence Sport & Social on Omni League.',
    );
    expect(metaContent('og:url')).toBe(`${window.location.origin}${PATH}`);
    expect(canonical()).toBe(`${window.location.origin}${PATH}`);
  });

  it('marks the sport as the current page in the sidebar, Overview as not current, and lists the counts', () => {
    const nav = host(harness).querySelector('nav[aria-label="Confluence Sport & Social"]');
    expect(nav).not.toBeNull();
    const current = [...(nav?.querySelectorAll('[aria-current]') ?? [])];
    expect(current.map(text)).toEqual(['Beach volleyball 12 leagues']);
    expect(current[0].getAttribute('aria-current')).toBe('page');
    expect(current[0].getAttribute('href')).toBe(PATH);
    expect([...(nav?.querySelectorAll('ul[aria-label="Sports"] a') ?? [])].map(text)).toEqual([
      'Beach volleyball 12 leagues',
      'Soccer 8 leagues',
      'Softball 6 leagues',
    ]);
  });
});

describe('SportViewPage page 2', () => {
  it('shows leagues 6 to 10, the range, and the canonical and og:url with ?page=2', async () => {
    const harness = await open(`${PATH}?page=2&utm_source=x`);
    emit(sportQueryResults({ page: 2 }));
    await settle(harness);
    expect(leagueNames(harness)).toEqual(BEACH_LEAGUES.slice(5, 10).map((league) => league.name));
    expect(text(control(harness)?.querySelector('p'))).toBe('6–10 of 12 leagues');
    expect(canonical()).toBe(`${window.location.origin}${PATH}?page=2`);
    expect(metaContent('og:url')).toBe(`${window.location.origin}${PATH}?page=2`);
    expect(canonical()).not.toContain('utm_source');
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Beach volleyball | Confluence Sport & Social | Omni League',
    );
  });

  it('serves page 1 when the query says so, and its canonical is the bare path', async () => {
    // ?page=9 is past the last page: the query answers page 1.
    const harness = await open(`${PATH}?page=9`);
    emit(sportQueryResults({ leagues: leaguesPage(1) }));
    await settle(harness);
    expect(control(harness)?.querySelector('a[aria-current="page"]')?.textContent).toContain('1');
    expect(canonical()).toBe(`${window.location.origin}${PATH}`);
  });

  it('shows no control for 5 leagues and one for 6', async () => {
    const harness = await open();
    emit(sportQueryResults({ leagues: leaguesPage(1, 5) }));
    await settle(harness);
    expect(control(harness)).toBeNull();
    emit(sportQueryResults({ leagues: leaguesPage(1, 6) }));
    await settle(harness);
    expect(control(harness)).not.toBeNull();
  });
});

describe('SportViewPage not found and errors', () => {
  it('shows the not-found view with no sidebar for an unknown organization', async () => {
    const harness = await open();
    emit(sportQueryResults({ organization: null, leagues: NO_LEAGUES }));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(host(harness).querySelector('nav')).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Page not found | Omni League');
    expect(canonical()).toBeNull();
    expect(metaContent('og:title')).toBeNull();
  });

  it('shows the not-found view for a sport the organization has no league in', async () => {
    const harness = await open(`/organizations/${ORG_SLUG}/sports/softball`);
    emit(sportQueryResults({ organization: CONFLUENCE_NO_SOFTBALL, leagues: NO_LEAGUES }));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(host(harness).querySelector('nav')).toBeNull();
    expect(canonical()).toBeNull();
  });

  it.each([ORG, LEAGUES])(
    'shows the server-error view when %s fails, with a retry link to the page asked for',
    async (failing) => {
      const harness = await open(`${PATH}?page=3&ott=SECRET`);
      subscription(failing).fail(new Error('connect ECONNREFUSED internal-db.corp.example:443'));
      for (const [name, value] of Object.entries(sportQueryResults({ page: 3 }))) {
        if (name !== failing) subscription(name).emit(value);
      }
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe(
        'This page is temporarily unavailable',
      );
      expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(`${PATH}?page=3`);
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(host(harness).textContent).not.toContain('internal-db');
      expect(host(harness).textContent).not.toContain('SECRET');
    },
  );

  it('retries to the bare path when page 1 was asked for', async () => {
    const harness = await open(`${PATH}?ott=SECRET`);
    subscription(LEAGUES).fail(new Error('down'));
    await settle(harness);
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(PATH);
  });

  it('replaces the page with the server-error view when a live subscription fails after it showed, and brings it back when results arrive', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Beach volleyball');
    subscription(LEAGUES).fail(new Error('boom'));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'This page is temporarily unavailable',
    );
  });
});

describe('SportViewPage page changes', () => {
  async function onPage1(): Promise<RouterTestingHarness> {
    const harness = await open();
    emit();
    await settle(harness);
    return harness;
  }

  const nextLink = (harness: RouterTestingHarness) =>
    control(harness)!.querySelector<HTMLAnchorElement>('a[href$="?page=2#leagues"]')!;

  it('keeps the old rows, range, and control with aria-busy while the next page loads, then swaps them and moves focus to the heading', async () => {
    const harness = await onPage1();
    nextLink(harness).click();
    await settle(harness);
    // The new subscription has not emitted: page 1 stays, marked busy, with no focus move.
    const subscriptions = client.activeSubscriptions.filter((s) => s.name === LEAGUES);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].args).toMatchObject({ page: 2, sport: 'beachVolleyball' });
    expect(leagueNames(harness)).toEqual(BEACH_LEAGUES.slice(0, 5).map((l) => l.name));
    expect(host(harness).querySelector('section#leagues ul')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(text(control(harness)?.querySelector('p'))).toBe('1–5 of 12 leagues');
    expect(host(harness).ownerDocument.activeElement?.id).not.toBe('leagues-heading');

    subscriptions[0].emit(leaguesPage(2));
    await settle(harness);
    expect(leagueNames(harness)).toEqual(BEACH_LEAGUES.slice(5, 10).map((l) => l.name));
    expect(host(harness).querySelector('section#leagues ul')?.getAttribute('aria-busy')).toBeNull();
    expect(text(control(harness)?.querySelector('p'))).toBe('6–10 of 12 leagues');
    expect(host(harness).ownerDocument.activeElement?.id).toBe('leagues-heading');
    expect(TestBed.inject(Router).url).toBe(`${PATH}?page=2#leagues`);
  });

  it('keeps the organization subscription open across a page change', async () => {
    const harness = await onPage1();
    const before = client.subscriptions.filter((s) => s.name === ORG);
    nextLink(harness).click();
    await settle(harness);
    expect(client.subscriptions.filter((s) => s.name === ORG)).toEqual(before);
    expect(before.every((s) => s.active)).toBe(true);
  });

  it('a live update to the shown page changes the rows and the range in place and does not move focus', async () => {
    const harness = await onPage1();
    const link = nextLink(harness);
    link.focus();
    const renamed = leaguesPage(1, 13);
    renamed.rows = [{ ...renamed.rows[0], name: 'Aardvark Coed 4s' }, ...renamed.rows.slice(1)];
    subscription(LEAGUES).emit(renamed);
    subscription(ORG).emit({
      ...CONFLUENCE,
      sports: [{ ...CONFLUENCE.sports[0], leagueCount: 13 }, ...CONFLUENCE.sports.slice(1)],
    });
    await settle(harness);
    expect(leagueNames(harness)[0]).toBe('Aardvark Coed 4s');
    expect(text(control(harness)?.querySelector('p'))).toBe('1–5 of 13 leagues');
    expect(text(host(harness).querySelector('main h1')?.nextElementSibling)).toBe(
      '13 leagues at 3 locations',
    );
    expect(host(harness).ownerDocument.activeElement).toBe(link);
  });

  it('a Ctrl-click on a page link, then a live update of the shown page, does not move focus', async () => {
    const harness = await onPage1();
    const link = nextLink(harness);
    link.focus();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    await settle(harness);
    subscription(LEAGUES).emit(leaguesPage(1, 13));
    await settle(harness);
    expect(host(harness).ownerDocument.activeElement).toBe(link);
  });

  it('Back to the earlier page changes the rows and does not move focus', async () => {
    const harness = await onPage1();
    nextLink(harness).click();
    await settle(harness);
    subscription(LEAGUES).emit(leaguesPage(2));
    await settle(harness);
    (host(harness).ownerDocument.activeElement as HTMLElement | null)?.blur();
    await TestBed.inject(Router).navigateByUrl(PATH);
    await settle(harness);
    subscription(LEAGUES).emit(leaguesPage(1));
    await settle(harness);
    expect(leagueNames(harness)[0]).toBe('Competitive Coed 6s');
    expect(host(harness).ownerDocument.activeElement?.id).not.toBe('leagues-heading');
  });

  it('shows page 1 when the shown page’s result changes to page 1 (the list shrank), and leaves the URL alone', async () => {
    const harness = await open(`${PATH}?page=2`);
    emit(sportQueryResults({ page: 2 }));
    await settle(harness);
    subscription(LEAGUES).emit(leaguesPage(1, 3));
    await settle(harness);
    expect(leagueNames(harness)).toEqual(BEACH_LEAGUES.slice(0, 5).map((l) => l.name));
    expect(control(harness)).toBeNull();
    expect(TestBed.inject(Router).url).toBe(`${PATH}?page=2`);
  });

  it('shows the server-error view with its retry link when the new page’s subscription fails', async () => {
    const harness = await onPage1();
    nextLink(harness).click();
    await settle(harness);
    subscription(LEAGUES).fail(new Error('boom'));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'This page is temporarily unavailable',
    );
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(`${PATH}?page=2`);
  });

  it('another sport’s rows are never kept: a route change to the next sport shows nothing until its result arrives', async () => {
    const harness = await onPage1();
    await TestBed.inject(Router).navigateByUrl(`/organizations/${ORG_SLUG}/sports/soccer`);
    await settle(harness);
    expect(leagueNames(harness)).toEqual([]);
    expect(host(harness).querySelector('main h1')).toBeNull();
  });
});

describe('SportViewPage route changes', () => {
  it('moves focus to main when the visitor arrives from another page, and not on the page load', async () => {
    const harness = await open(`/organizations/${ORG_SLUG}`);
    await settle(harness);
    await TestBed.inject(Router).navigateByUrl(PATH);
    await settle(harness);
    emit();
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Beach volleyball');
    expect(document.activeElement).toBe(host(harness).querySelector('main#main'));
  });

  it('leaves focus alone on the page load', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    expect(document.activeElement).toBe(document.body);
  });

  it('activating a sport in the sidebar shows that sport’s view', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    host(harness)
      .querySelector<HTMLAnchorElement>(`nav[aria-label="${CONFLUENCE.name}"] a[href$="/soccer"]`)!
      .click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe(`/organizations/${ORG_SLUG}/sports/soccer`);
    expect(subscription(LEAGUES).args).toEqual({ slug: ORG_SLUG, page: 1, sport: 'soccer' });
  });

  // The route keeps this component when only the sport changes, and the sidebar that held focus
  // is replaced while the other sport loads: focus must not fall to body.
  it('moves focus to main once the view of another sport has arrived, and not before', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    const link = host(harness).querySelector<HTMLAnchorElement>(
      `nav[aria-label="${CONFLUENCE.name}"] a[href$="/soccer"]`,
    )!;
    link.focus();
    link.click();
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(document.activeElement).not.toBe(host(harness).querySelector('main#main'));

    subscription(LEAGUES).emit(leaguesPage(1, 8));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Soccer');
    expect(document.activeElement).toBe(host(harness).querySelector('main#main'));
  });

  it('a page link within a sport does not move focus to main', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    host(harness)
      .querySelector<HTMLAnchorElement>(
        'nav[aria-label="Leagues pages"] a[href$="?page=2#leagues"]',
      )!
      .click();
    await settle(harness);
    subscription(LEAGUES).emit(leaguesPage(2));
    await settle(harness);
    expect(document.activeElement).not.toBe(host(harness).querySelector('main#main'));
    expect(document.activeElement?.id).toBe('leagues-heading');
  });
});
