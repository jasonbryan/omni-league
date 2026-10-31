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
  at,
  leagueQueryResults,
  NO_SEASONS,
  OPEN_DAY,
  SEASONS,
  seasonsPage,
  SUNDAY_4S,
  without,
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
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at(OPEN_DAY));
});

afterEach(() => {
  vi.useRealTimers();
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

  it('shows the skeleton in the layout until all three results have arrived, then the page in its place', async () => {
    const harness = await open();
    const results = leagueQueryResults();
    subscription(ORG).emit(results[ORG]);
    subscription(LEAGUE).emit(results[LEAGUE]);
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('main nav')).toBeNull();
    const skeleton = host(harness).querySelector('main [data-testid="league-skeleton"]');
    expect(skeleton).not.toBeNull();
    const status = skeleton?.querySelector('[role="status"]');
    expect(text(status)).toBe('Loading the league.');
    expect(status?.className).toContain('sr-only');
    expect(skeleton?.querySelector('h1, h2, h3, a')).toBeNull();
    subscription(SEASONS_QUERY).emit(results[SEASONS_QUERY]);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Sunday Reverse Coed 4s');
    expect(host(harness).querySelector('[data-testid="league-skeleton"]')).toBeNull();
  });
});

describe('PublicLeaguePage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb organization and sport, and the league as the only h1', () => {
    const main = host(harness).querySelector('main');
    const links = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] a') ?? [])];
    expect(links.map(text)).toEqual(['Gulf Coast Sport & Social', 'Beach volleyball']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/organizations/gulf-coast-sport-social',
      '/organizations/gulf-coast-sport-social/sports/beach-volleyball',
    ]);
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Sunday Reverse Coed 4s');
  });

  it('shows the division label and the sport with its locations under the h1', () => {
    const lines = [...host(harness).querySelectorAll('main h1 ~ p')].map(text);
    expect(lines).toEqual(['Coed · 4v4 · BB', 'Beach volleyball · North Beach Sand Courts']);
  });

  it('leaves out the division line for a league with no division, and lists several locations in order', async () => {
    emit(
      leagueQueryResults({
        league: {
          ...without(SUNDAY_4S, 'divisionLabel'),
          locationNames: ['Bayside Athletic Complex', 'North Beach Sand Courts'],
        },
      }),
    );
    await settle(harness);
    expect([...host(harness).querySelectorAll('main h1 ~ p')].map(text)).toEqual([
      'Beach volleyball · Bayside Athletic Complex, North Beach Sand Courts',
    ]);
  });

  describe('the open season card', () => {
    const card = () => host(harness).querySelector('section#registration-open');

    it('comes first, with the season, dates, division and team size, deadline, and a Register link', () => {
      expect(text(card()?.querySelector('h2'))).toBe('Registration open');
      expect(text(card()?.querySelector('h3'))).toBe('Summer 2027');
      expect([...(card()?.querySelectorAll('ul li') ?? [])].map(text)).toEqual([
        'Jun 6 – Aug 29, 2027',
        'Coed · 4v4 · BB, teams of at least 4',
        'Closes May 23, 2027',
      ]);
      const register = card()?.querySelector<HTMLAnchorElement>('a[data-slot="button"]');
      expect(text(register)).toBe('Register for Summer 2027');
      expect(register?.getAttribute('href')).toBe(`${PATH}/seasons/summer-2027#registration`);
      expect(register?.className).toContain('h-11');
      const sections = [...host(harness).querySelectorAll('main section')].map((el) => el.id);
      expect(sections.slice(0, 2)).toEqual(['registration-open', 'seasons']);
    });

    it('says only that teams need a minimum when the league has no division label', async () => {
      emit(leagueQueryResults({ league: without(SUNDAY_4S, 'divisionLabel') }));
      await settle(harness);
      expect(text(card()?.querySelectorAll('ul li')[1])).toBe('Teams of at least 4');
    });

    it('still shows on page 2 of the seasons, from the league’s own seasons', async () => {
      await TestBed.inject(Router).navigateByUrl(`${PATH}?page=2#seasons`);
      await settle(harness);
      subscription(SEASONS_QUERY).emit(seasonsPage(2));
      await settle(harness);
      expect([...host(harness).querySelectorAll('section#seasons > ul > li h3')].map(text)).toEqual(
        ['Fall 2025', 'Summer 2025'],
      );
      expect(text(card()?.querySelector('h3'))).toBe('Summer 2027');
    });

    it('shows the open season whatever the others’ status, and the other row reads In progress', () => {
      expect(text(card()?.querySelector('h3'))).toBe('Summer 2027');
      const rows = [...host(harness).querySelectorAll('section#seasons > ul > li')];
      expect(text(rows[1].querySelector('[data-slot="badge"]'))).toBe('In progress');
    });

    it('shows the one with the soonest deadline when two are open', async () => {
      emit(
        leagueQueryResults({
          league: {
            ...SUNDAY_4S,
            seasons: [
              {
                name: 'Fall 2027',
                slug: 'fall-2027',
                startDate: '2027-09-12',
                endDate: '2027-11-14',
                registrationDeadline: '2027-08-29',
                minimumRosterSize: 4,
              },
              ...(SUNDAY_4S.seasons ?? []),
            ],
          },
        }),
      );
      await settle(harness);
      expect(text(card()?.querySelector('h3'))).toBe('Summer 2027');
    });

    it('shows the open season that starts first when two share a deadline, then the lower slug', async () => {
      const tied = (name: string, slug: string, startDate: string) => ({
        name,
        slug,
        startDate,
        endDate: '2027-11-14',
        registrationDeadline: '2027-08-29',
        minimumRosterSize: 4,
      });
      const withTied = (...seasons: ReturnType<typeof tied>[]) =>
        leagueQueryResults({ league: { ...SUNDAY_4S, seasons } });
      emit(withTied(tied('Later', 'a', '2027-09-20'), tied('Earlier', 'c', '2027-09-12')));
      await settle(harness);
      expect(text(card()?.querySelector('h3'))).toBe('Earlier');
      emit(
        withTied(
          tied('Later', 'a', '2027-09-20'),
          tied('Earlier', 'c', '2027-09-12'),
          tied('Same start', 'b', '2027-09-12'),
        ),
      );
      await settle(harness);
      expect(text(card()?.querySelector('h3'))).toBe('Same start');
    });

    it('is not shown for a copy of the league saved before it held its seasons', async () => {
      emit(leagueQueryResults({ league: without(SUNDAY_4S, 'seasons') }));
      await settle(harness);
      expect(card()).toBeNull();
      expect(host(harness).querySelectorAll('section#seasons > ul > li')).toHaveLength(5);
    });
  });

  it('lists the seasons newest first, each name a link to its season page, with dates and status', () => {
    const panel = host(harness).querySelector('section#seasons');
    expect(panel?.getAttribute('aria-labelledby')).toBe('seasons-heading');
    expect(text(panel?.querySelector('h2'))).toBe('Seasons');
    expect(text(panel?.querySelector('h2 + p'))).toBe('7 seasons');
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
    const statuses = rows.map((row) =>
      [...(row.querySelector('p:last-of-type')?.children ?? [])].map(text),
    );
    expect(statuses).toEqual([
      ['Registration open', 'closes May 23, 2027'],
      ['In progress', 'registration closed'],
      ['Ended'],
      ['Ended'],
      ['Ended'],
    ]);
  });

  it('marks the open status apart from the others, and the row has no format badge', () => {
    const badges = [...host(harness).querySelectorAll('section#seasons [data-slot="badge"]')];
    expect(badges[0].className).toContain('bg-secondary');
    expect(badges[1].className).toContain('bg-muted');
    expect(host(harness).querySelector('section#seasons')?.textContent).not.toContain('4v4');
  });

  it('says "1 season" for one, and shows no status for a row from a copy saved before rows held their deadline', async () => {
    emit(
      leagueQueryResults({
        seasons: {
          rows: [{ ...SEASONS[0], registrationDeadline: undefined }],
          page: 1,
          pageCount: 1,
          total: 1,
        },
      }),
    );
    await settle(harness);
    expect(text(host(harness).querySelector('section#seasons h2 + p'))).toBe('1 season');
    expect(host(harness).querySelector('section#seasons li [data-slot="badge"]')).toBeNull();
  });

  describe('where it is played and who runs it', () => {
    const where = () => host(harness).querySelector('section#where');

    it('lists each location with its address, then who runs the league, linking to the organization', () => {
      expect(text(where()?.querySelector('h2'))).toBe('Where it’s played');
      const place = where()?.querySelector('li');
      expect(text(place?.querySelector('h3'))).toBe('North Beach Sand Courts');
      expect(text(place?.querySelector('p'))).toBe('3500 Sandcourt Ln, Corpus Christi, TX 78402');
      const runBy = where()?.querySelector(':scope > p');
      expect(text(runBy)).toBe('Run by Gulf Coast Sport & Social');
      expect(runBy?.querySelector('a')?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social',
      );
    });

    it('lists the names alone for a copy saved before the page held addresses', async () => {
      emit(leagueQueryResults({ league: without(SUNDAY_4S, 'locations') }));
      await settle(harness);
      expect([...(where()?.querySelectorAll('li') ?? [])].map(text)).toEqual([
        'North Beach Sand Courts',
      ]);
    });
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

describe('PublicLeaguePage after every registration deadline has passed', () => {
  it('shows no card, and the closed season’s row reads Registration closed', async () => {
    vi.setSystemTime(at('2027-05-30'));
    const harness = await open();
    emit();
    await settle(harness);
    expect(host(harness).querySelector('section#registration-open')).toBeNull();
    const rows = [...host(harness).querySelectorAll('section#seasons > ul > li')];
    expect(text(rows[0].querySelector('[data-slot="badge"]'))).toBe('Registration closed');
    expect(text(rows[1].querySelector('[data-slot="badge"]'))).toBe('Ended');
  });
});

describe('PublicLeaguePage with no published season', () => {
  it('shows the empty state in the Seasons panel and no control', async () => {
    const harness = await open();
    emit(leagueQueryResults({ league: { ...SUNDAY_4S, seasons: [] }, seasons: NO_SEASONS }));
    await settle(harness);
    const panel = host(harness).querySelector('section#seasons');
    expect(text(panel?.querySelector('h2'))).toBe('Seasons');
    expect(text(panel)).toContain('No seasons yet');
    expect(text(panel)).toContain(
      'When Gulf Coast Sport & Social publishes a season, its dates and registration appear here.',
    );
    const link = panel?.querySelector('a');
    expect(text(link)).toBe('See their other leagues');
    expect(link?.getAttribute('href')).toBe('/organizations/gulf-coast-sport-social');
    expect(panel?.querySelectorAll('li')).toHaveLength(0);
    expect(host(harness).querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
    expect(host(harness).querySelector('section#registration-open')).toBeNull();
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

  it('moves focus from a Seasons pages link pressed by keyboard to the server-error view h1 when the new page fails', async () => {
    const harness = await onPage1();
    const next = host(harness).querySelector<HTMLAnchorElement>(
      'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
    )!;
    next.focus();
    next.click();
    await settle(harness);
    subscription(SEASONS_QUERY).fail(new Error('boom'));
    await settle(harness);
    const heading = host(harness).querySelector('main h1');
    expect(text(heading)).toBe('This page is temporarily unavailable');
    expect(host(harness).ownerDocument.activeElement).toBe(heading);
  });
});

describe('PublicLeaguePage open season first and the seasons intro', () => {
  const INTRO =
    'Each season is one run of Sunday Reverse Coed 4s, with its own dates, registration, teams, and schedule.';

  it('starts the open season card with "Registration open" and puts it before the Seasons heading', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    const card = host(harness).querySelector('section#registration-open');
    const seasons = host(harness).querySelector('section#seasons');
    expect(text(card)).toMatch(/^Registration open /);
    expect(card!.compareDocumentPosition(seasons!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the league in a line under the Seasons heading', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    const panel = host(harness).querySelector('section#seasons');
    const heading = panel?.querySelector('h2');
    expect(text(heading?.parentElement?.nextElementSibling)).toBe(INTRO);
  });

  it('shows the same line above "No seasons yet" when the league has no season', async () => {
    const harness = await open();
    emit(leagueQueryResults({ league: { ...SUNDAY_4S, seasons: [] }, seasons: NO_SEASONS }));
    await settle(harness);
    const panelText = text(host(harness).querySelector('section#seasons'));
    expect(panelText).toContain(INTRO);
    expect(panelText.indexOf(INTRO)).toBeLessThan(panelText.indexOf('No seasons yet'));
  });
});
