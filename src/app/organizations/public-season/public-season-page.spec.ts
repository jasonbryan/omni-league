import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicSeasonPage } from './public-season-page';
import { seasonQueryResults, SUMMER_2027 } from './testing/season-data';

const ORG = 'organizations:getPublicPage';
const SEASON = 'seasons:getPublicPage';
const LEAGUE_PATH = '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s';
const PATH = `${LEAGUE_PATH}/seasons/summer-2027`;

let client: FakeConvexClient;

async function open(url = PATH): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: 'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug',
          component: PublicSeasonPage,
        },
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

function emit(results: Record<string, unknown> = seasonQueryResults()): void {
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

function details(harness: RouterTestingHarness): [string, string][] {
  return [...host(harness).querySelectorAll('main dl > div')].map((row) => [
    text(row.querySelector('dt')),
    text(row.querySelector('dd')),
  ]);
}

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

describe('PublicSeasonPage queries', () => {
  it("asks for the organization and the season with the route's slugs only", async () => {
    await open(`${PATH}?ott=SECRET&utm_source=x#details`);
    expect(
      client.activeSubscriptions
        .map(({ name, args }) => ({ name, args }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ).toEqual([
      { name: ORG, args: { slug: 'gulf-coast-sport-social' } },
      {
        name: SEASON,
        args: {
          orgSlug: 'gulf-coast-sport-social',
          leagueSlug: 'sunday-reverse-coed-4s',
          seasonSlug: 'summer-2027',
        },
      },
    ]);
  });

  it('shows nothing but the shell until both results have arrived', async () => {
    const harness = await open();
    subscription(ORG).emit(seasonQueryResults()[ORG]);
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('nav')).toBeNull();
    subscription(SEASON).emit(SUMMER_2027);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe('Summer 2027');
  });
});

describe('PublicSeasonPage populated', () => {
  let harness: RouterTestingHarness;
  beforeEach(async () => {
    harness = await open();
    emit();
    await settle(harness);
  });

  it('renders the breadcrumb organization, league, season, and the season as the only h1', () => {
    const main = host(harness).querySelector('main');
    const crumbs = [...(main?.querySelectorAll('nav[aria-label="Breadcrumb"] li') ?? [])];
    const links = crumbs.filter((li) => li.querySelector('a')).map((li) => li.querySelector('a'));
    expect(links.map(text)).toEqual([
      'Gulf Coast Sport & Social',
      'Sunday Reverse Coed 4s',
      'Summer 2027',
    ]);
    expect(links.map((a) => a?.getAttribute('href'))).toEqual([
      '/organizations/gulf-coast-sport-social',
      LEAGUE_PATH,
      PATH,
    ]);
    expect(links.map((a) => a?.getAttribute('aria-current'))).toEqual([null, null, 'page']);
    expect(crumbs.filter((li) => li.getAttribute('aria-hidden') === 'true')).toHaveLength(2);
    expect(main?.querySelectorAll('h1')).toHaveLength(1);
    expect(text(main?.querySelector('h1'))).toBe('Summer 2027');
  });

  it('shows the sport badge and the league’s name under the h1', () => {
    const row = host(harness).querySelector('main h1')?.nextElementSibling;
    expect(text(row?.querySelector('[data-slot="badge"]'))).toBe('Beach volleyball');
    expect([...(row?.children ?? [])].map(text)).toEqual([
      'Beach volleyball',
      'Sunday Reverse Coed 4s',
    ]);
  });

  it('lists the dates, format, team size, and location in a labelled details list', () => {
    const panel = host(harness).querySelector('main section[aria-labelledby="details-heading"]');
    expect(text(panel?.querySelector('h2'))).toBe('Season details');
    expect(details(harness)).toEqual([
      ['Dates', 'Jun 6 – Aug 29, 2027'],
      ['Format', '4 v 4'],
      ['Team size', 'Teams need at least 4 players'],
      ['Location', 'North Beach Sand Courts'],
    ]);
  });

  it('marks up each date with its stored value', () => {
    const times = [...host(harness).querySelectorAll('main dl time')];
    expect(times.map((time) => [text(time), time.getAttribute('datetime')])).toEqual([
      ['Jun 6', '2027-06-06'],
      ['Aug 29, 2027', '2027-08-29'],
    ]);
  });

  it('shows no price and no registration action or panel', () => {
    const main = text(host(harness).querySelector('main'));
    expect(main).not.toMatch(/\$|price|fee/i);
    expect(main).not.toMatch(/register|registration/i);
    expect(
      host(harness).querySelector('main section[aria-labelledby="registration-heading"]'),
    ).toBeNull();
    expect(host(harness).querySelectorAll('main button')).toHaveLength(0);
    expect(host(harness).querySelectorAll('main section')).toHaveLength(1);
  });

  it('sets the title and the Open Graph tags from the results, with the season’s path as canonical', () => {
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Summer 2027 | Sunday Reverse Coed 4s | Omni League',
    );
    expect(metaContent('og:title')).toBe('Summer 2027');
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Jun 6 – Aug 29, 2027. 4 v 4, teams need at least 4 players.',
    );
    expect(metaContent('og:url')).toBe(`${window.location.origin}${PATH}`);
    expect(canonical()).toBe(`${window.location.origin}${PATH}`);
  });

  it('marks the league’s sport as the current section of the sidebar, as plain text until the sport view exists', () => {
    const nav = host(harness).querySelector('nav[aria-label="Gulf Coast Sport & Social"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelectorAll('ul[aria-label="Sports"] a')).toHaveLength(0);
    const sports = [...(nav?.querySelectorAll('ul[aria-label="Sports"] li > *') ?? [])];
    expect(
      sports.map((el) => [text(el.querySelector('span.min-w-0')), el.getAttribute('aria-current')]),
    ).toEqual([
      ['Beach volleyball', 'true'],
      ['Soccer', null],
      ['Softball', null],
    ]);
  });

  it('writes several locations as "Locations", in the league’s order', async () => {
    emit(
      seasonQueryResults({
        season: {
          ...SUMMER_2027,
          league: {
            ...SUMMER_2027.league,
            locationNames: ['Bayside Athletic Complex', 'North Beach Sand Courts'],
          },
        },
      }),
    );
    await settle(harness);
    expect(details(harness)[3]).toEqual([
      'Locations',
      'Bayside Athletic Complex, North Beach Sand Courts',
    ]);
  });

  it('leaves out the location row when the league has no location name', async () => {
    emit(
      seasonQueryResults({
        season: { ...SUMMER_2027, league: { ...SUMMER_2027.league, locationNames: [] } },
      }),
    );
    await settle(harness);
    expect(details(harness).map(([term]) => term)).toEqual(['Dates', 'Format', 'Team size']);
  });

  it('writes one date for a season of one day and both years across two', async () => {
    emit(
      seasonQueryResults({
        season: { ...SUMMER_2027, startDate: '2027-09-08', endDate: '2027-09-08' },
      }),
    );
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', 'Sep 8, 2027']);
    expect(host(harness).querySelectorAll('main dl time')).toHaveLength(1);
    emit(
      seasonQueryResults({
        season: { ...SUMMER_2027, startDate: '2027-12-01', endDate: '2028-02-20' },
      }),
    );
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', 'Dec 1, 2027 – Feb 20, 2028']);
  });

  it('updates in place when the season’s dates and roster size change on the server', async () => {
    const h1 = host(harness).querySelector('main h1');
    emit(
      seasonQueryResults({
        season: {
          ...SUMMER_2027,
          startDate: '2027-06-13',
          endDate: '2027-09-05',
          minimumRosterSize: 6,
        },
      }),
    );
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', 'Jun 13 – Sep 5, 2027']);
    expect(details(harness)[2]).toEqual(['Team size', 'Teams need at least 6 players']);
    expect(metaContent('og:description')).toBe(
      'Jun 13 – Sep 5, 2027. 4 v 4, teams need at least 6 players.',
    );
    expect(host(harness).querySelector('main h1')).toBe(h1);
  });
});

describe('PublicSeasonPage not found and failures', () => {
  it.each([
    ['a null season (a draft or an unknown one)', { season: null }],
    ['an unknown organization', { organization: null, season: null }],
  ])('shows the not-found view, with no sidebar, for %s', async (_label, options) => {
    const harness = await open();
    emit(seasonQueryResults(options));
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(host(harness).querySelector('nav')).toBeNull();
    expect(head().querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
  });

  it.each([ORG, SEASON])('shows the server-error view when %s fails', async (failing) => {
    const harness = await open(`${PATH}?x=1`);
    for (const [name, value] of Object.entries(seasonQueryResults())) {
      if (name === failing) subscription(name).fail(new Error('connect ECONNREFUSED internal-db'));
      else subscription(name).emit(value);
    }
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(PATH);
    expect(host(harness).textContent).not.toContain('internal-db');
    expect(host(harness).querySelector('nav')).toBeNull();
  });
});
