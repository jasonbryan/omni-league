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
import { PAGE_LOAD_WAIT_MS } from '../../public-layout/page-load-wait-ms';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { allRadiusClasses } from '../../ui/testing/radius-classes';
import { PublicSeasonPage } from './public-season-page';
import {
  NO_TEAMS,
  seasonQueryResults,
  SUMMER_2027,
  TEAM_NAMES,
  teamsPage,
  without,
} from './testing/season-data';

const SEASON = 'seasons:getPublicPage';
const TEAMS = 'teams:listPublic';
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
// The template drops the whitespace between elements, so `textContent` runs a label into its value.
const spaced = (el: Element | null | undefined) =>
  (el?.innerHTML ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const head = () => TestBed.inject(DOCUMENT).head;
const metaContent = (property: string) =>
  head().querySelector(`meta[property="${property}"]`)?.getAttribute('content') ?? null;
const canonical = () => head().querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

function details(harness: RouterTestingHarness): [string, string[]][] {
  return [...host(harness).querySelectorAll('main dl > div')].map((row) => [
    text(row.querySelector('dt')),
    [...row.querySelectorAll('dd')].map(spaced),
  ]);
}

const card = (harness: RouterTestingHarness) => host(harness).querySelector('#registration');

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);
const HOUR = 60 * 60 * 1000;

// Each live result is saved to localStorage; a saved copy from one test must not seed the next one, nor a later spec file (spec files share one global).
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-04-01'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  for (const el of head().querySelectorAll('meta[property^="og:"], link[rel="canonical"]')) {
    el.remove();
  }
});

describe('PublicSeasonPage queries', () => {
  it("asks for the season with the route's slugs only, and its teams' page 1", async () => {
    await open(`${PATH}?ott=SECRET&utm_source=x#details`);
    expect(
      client.activeSubscriptions
        .map(({ name, args }) => ({ name, args }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    ).toEqual([
      {
        name: SEASON,
        args: {
          orgSlug: 'gulf-coast-sport-social',
          leagueSlug: 'sunday-reverse-coed-4s',
          seasonSlug: 'summer-2027',
        },
      },
      {
        name: TEAMS,
        args: {
          orgSlug: 'gulf-coast-sport-social',
          leagueSlug: 'sunday-reverse-coed-4s',
          seasonSlug: 'summer-2027',
          page: 1,
        },
      },
    ]);
  });

  it('shows the skeleton with its status and no heading until the result has arrived', async () => {
    const harness = await open();
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('main nav')).toBeNull();
    const skeleton = host(harness).querySelector('[data-testid="season-skeleton"]');
    expect(text(skeleton?.querySelector('[role="status"]'))).toBe('Loading the season.');
    expect(skeleton?.querySelector('[role="status"]')?.classList).toContain('sr-only');
    expect(skeleton?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    emit();
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'Sunday Reverse Coed 4s · Summer 2027',
    );
    expect(host(harness).querySelector('[data-testid="season-skeleton"]')).toBeNull();
  });

  it('draws both skeleton badges rounded-full and each fact icon rounded-lg', async () => {
    const harness = await open();
    await settle(harness);
    const skeleton = host(harness).querySelector('[data-testid="season-skeleton"]')!;
    const badges = skeleton.querySelectorAll('span.h-5\\.5');
    expect(allRadiusClasses(badges)).toEqual([['rounded-full'], ['rounded-full']]);
    const icons = skeleton.querySelectorAll(
      '[data-testid="season-skeleton-details"] .flex.gap-4 > span',
    );
    expect(icons.length).toBeGreaterThan(0);
    expect(allRadiusClasses(icons)).toEqual(Array.from(icons, () => ['rounded-lg']));
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
    expect(text(main?.querySelector('h1'))).toBe('Sunday Reverse Coed 4s · Summer 2027');
  });

  it('shows the sport badge above the h1, which names the league and the season together', () => {
    const h1 = host(harness).querySelector('main h1');
    expect(text(h1?.previousElementSibling?.querySelector('[data-slot="badge"]'))).toBe(
      'Beach volleyball',
    );
    expect(text(h1)).toBe('Sunday Reverse Coed 4s · Summer 2027');
  });

  it('puts the registration card after the h1 and before the season details', () => {
    const main = host(harness).querySelector('main')!;
    const h1 = main.querySelector('h1')!;
    const registration = main.querySelector('#registration')!;
    const details = main.querySelector('section[aria-labelledby="details-heading"]')!;
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(h1.compareDocumentPosition(registration) & follows).toBeTruthy();
    expect(registration.compareDocumentPosition(details) & follows).toBeTruthy();
  });

  it('lists the dates, division, deadline, and location with its address in a labelled details list', () => {
    const panel = host(harness).querySelector('main section[aria-labelledby="details-heading"]');
    expect(text(panel?.querySelector('h2'))).toBe('Season details');
    expect(details(harness)).toEqual([
      ['Dates', ['Jun 6 – Aug 29, 2027']],
      ['Division', ['Coed · 4v4 · Rec', 'From the league · teams need at least 4 players']],
      ['Registration closes', ['May 23, 2027']],
      ['Location', ['North Beach Sand Courts 3500 Sandcourt Ln, Corpus Christi, TX 78402']],
    ]);
    expect(text(host(harness).querySelector('main dl'))).not.toMatch(/weeks|Sundays/);
  });

  it('marks up each date with its stored value', () => {
    const times = [...host(harness).querySelectorAll('main dl time')];
    expect(times.map((time) => [text(time), time.getAttribute('datetime')])).toEqual([
      ['Jun 6', '2027-06-06'],
      ['Aug 29, 2027', '2027-08-29'],
      ['May 23, 2027', '2027-05-23'],
    ]);
  });

  it('shows an open card with the deadline, both register links, and the line about teams and free agents', () => {
    const open = card(harness);
    expect(text(open?.querySelector('h2'))).toBe('Registration');
    expect(spaced(open)).toContain('Registration open');
    expect(spaced(open)).toContain('Registration open · closes May 23, 2027');
    expect(spaced(open)).toContain(
      'Captains register a team, then invite their players. Without a team? Register as a free agent, and an organizer places you on one.',
    );
    const links = [...(open?.querySelectorAll('a') ?? [])];
    expect(links.map((link) => [text(link), link.getAttribute('href')])).toEqual([
      [
        'Register a team',
        '/app/register/gulf-coast-sport-social/sunday-reverse-coed-4s/summer-2027/team',
      ],
      [
        'Register as a free agent',
        '/app/register/gulf-coast-sport-social/sunday-reverse-coed-4s/summer-2027/free-agent',
      ],
    ]);
  });

  it('explains how registration works in three numbered steps', () => {
    const section = host(harness).querySelector('section[aria-labelledby="how-heading"]');
    expect(text(section?.querySelector('h2'))).toBe('How registration works');
    expect([...(section?.querySelectorAll('li') ?? [])].map(spaced)).toEqual([
      '1 Register Register a team as its captain, or register on your own as a free agent.',
      '2 Build your roster Captains share an invite link. Teams need at least 4 players before registration closes.',
      '3 Play Games start Jun 6, 2027 at North Beach Sand Courts.',
    ]);
  });

  it('shows no price', () => {
    expect(text(host(harness).querySelector('main'))).not.toMatch(/\$|price|fee/i);
  });

  it('sets the title and the Open Graph tags from the results, with the season’s path as canonical', () => {
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Sunday Reverse Coed 4s · Summer 2027 | Gulf Coast Sport & Social | Omni League',
    );
    expect(metaContent('og:title')).toBe(
      'Sunday Reverse Coed 4s · Summer 2027 | Gulf Coast Sport & Social | Omni League',
    );
    expect(metaContent('og:type')).toBe('website');
    expect(metaContent('og:description')).toBe(
      'Jun 6 – Aug 29, 2027. 4v4, teams need at least 4 players.',
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

  it('writes several locations as "Locations", in the league’s order, each with its address', async () => {
    emit(
      seasonQueryResults({
        season: {
          ...SUMMER_2027,
          league: {
            ...SUMMER_2027.league,
            locations: [
              { name: 'Bayside Athletic Complex', address: '1 Bay Road, Corpus Christi, TX 78412' },
              { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln' },
            ],
          },
        },
      }),
    );
    await settle(harness);
    expect(details(harness)[3]).toEqual([
      'Locations',
      [
        'Bayside Athletic Complex 1 Bay Road, Corpus Christi, TX 78412',
        'North Beach Sand Courts 3500 Sandcourt Ln',
      ],
    ]);
  });

  it('shows the names alone for a saved copy made before addresses were stored', async () => {
    const league = without(SUMMER_2027.league, 'locations');
    emit(seasonQueryResults({ season: { ...SUMMER_2027, league } }));
    await settle(harness);
    expect(details(harness)[3]).toEqual(['Location', ['North Beach Sand Courts']]);
  });

  it('leaves out the location row when the league has no location name', async () => {
    emit(
      seasonQueryResults({
        season: {
          ...SUMMER_2027,
          league: { ...SUMMER_2027.league, locationNames: [], locations: [] },
        },
      }),
    );
    await settle(harness);
    expect(details(harness).map(([term]) => term)).toEqual([
      'Dates',
      'Division',
      'Registration closes',
    ]);
    expect(text(host(harness).querySelector('section[aria-labelledby="how-heading"]'))).toContain(
      'Games start Jun 6, 2027.',
    );
  });

  it('shows the format and the team size for a league with no division yet', async () => {
    const league = without(SUMMER_2027.league, 'divisionLabel');
    emit(seasonQueryResults({ season: { ...SUMMER_2027, league } }));
    await settle(harness);
    expect(details(harness)[1]).toEqual(['Division', ['4v4', 'Teams need at least 4 players']]);
  });

  it('writes one date for a season of one day and both years across two', async () => {
    emit(
      seasonQueryResults({
        season: { ...SUMMER_2027, startDate: '2027-09-08', endDate: '2027-09-08' },
      }),
    );
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', ['Sep 8, 2027']]);
    expect(host(harness).querySelectorAll('main dl > div:first-child time')).toHaveLength(1);
    emit(
      seasonQueryResults({
        season: { ...SUMMER_2027, startDate: '2027-12-01', endDate: '2028-02-20' },
      }),
    );
    await settle(harness);
    expect(details(harness)[0]).toEqual(['Dates', ['Dec 1, 2027 – Feb 20, 2028']]);
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
    expect(details(harness)[0]).toEqual(['Dates', ['Jun 13 – Sep 5, 2027']]);
    expect(details(harness)[1][1][1]).toBe('From the league · teams need at least 6 players');
    expect(metaContent('og:description')).toBe(
      'Jun 13 – Sep 5, 2027. 4v4, teams need at least 6 players.',
    );
    expect(host(harness).querySelector('main h1')).toBe(h1);
  });
});

describe('PublicSeasonPage registration card', () => {
  const FALL_2027 = {
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-12',
    registrationDeadline: '2027-09-05',
  };
  const withUpcoming = (upcoming: (typeof FALL_2027)[]) =>
    seasonQueryResults({
      season: {
        ...SUMMER_2027,
        league: {
          ...SUMMER_2027.league,
          upcomingSeasons: [...(SUMMER_2027.league.upcomingSeasons ?? []), ...upcoming],
        },
      },
    });

  it.each([
    ['2027-05-01', 'Registration open'],
    ['2027-05-30', 'Registration closed'],
    ['2027-07-01', 'In progress'],
    ['2027-09-15', 'Ended'],
  ])('on %s the badge beside the heading reads %s', async (date, label) => {
    vi.setSystemTime(at(date));
    const harness = await open();
    emit();
    await settle(harness);
    const row = host(harness).querySelector('main h1')?.previousElementSibling;
    expect([...(row?.children ?? [])].map(text)).toEqual(['Beach volleyball', label]);
    expect(text(row?.querySelector('[data-testid="season-phase"]'))).toBe(label);
  });

  it('shows no phase badge for a saved copy made before the deadline was stored', async () => {
    const harness = await open();
    emit(seasonQueryResults({ season: without(SUMMER_2027, 'registrationDeadline') }));
    await settle(harness);
    expect(host(harness).querySelector('[data-testid="season-phase"]')).toBeNull();
  });

  it('shows the closed card with a link to the league’s open season', async () => {
    vi.setSystemTime(at('2027-07-01'));
    const harness = await open();
    emit(withUpcoming([FALL_2027]));
    await settle(harness);
    const closed = card(harness);
    expect(spaced(closed)).toContain('Registration closed');
    expect(spaced(closed)).toContain('Registration closed on May 23, 2027');
    expect(spaced(closed)).toContain(
      'This season is underway. Registration is open for Fall 2027.',
    );
    const link = closed?.querySelector('a');
    expect(text(link)).toBe('See Fall 2027');
    expect(link?.getAttribute('href')).toBe(`${LEAGUE_PATH}/seasons/fall-2027`);
    expect(host(harness).querySelector('section[aria-labelledby="how-heading"]')).toBeNull();
    expect(spaced(closed)).not.toContain('Captains register a team');
  });

  it('shows the full card with Join the waitlist and the free-agent link, and a Full badge, while registration is open', async () => {
    vi.setSystemTime(at('2027-05-01'));
    const harness = await open();
    emit(seasonQueryResults({ season: { ...SUMMER_2027, isFull: true, maxTeams: 2 } }));
    await settle(harness);
    const full = card(harness);
    expect(spaced(full)).toContain('This season is full');
    expect(spaced(full)).toContain(
      'Join the waitlist and an organizer offers you a place if one opens. Registration closes May 23, 2027.',
    );
    const links = [...(full?.querySelectorAll('a') ?? [])];
    expect(links.map((link) => [text(link), link.getAttribute('href')])).toEqual([
      [
        'Join the waitlist',
        '/app/register/gulf-coast-sport-social/sunday-reverse-coed-4s/summer-2027/team',
      ],
      [
        'Register as a free agent',
        '/app/register/gulf-coast-sport-social/sunday-reverse-coed-4s/summer-2027/free-agent',
      ],
    ]);
    expect(text(host(harness).querySelector('[data-testid="season-phase"]'))).toBe('Full');
  });

  it('shows the closed card, not the full one, once a full season’s registration closes', async () => {
    vi.setSystemTime(at('2027-05-30'));
    const harness = await open();
    emit(seasonQueryResults({ season: { ...SUMMER_2027, isFull: true, maxTeams: 2 } }));
    await settle(harness);
    expect(spaced(card(harness))).toContain('Registration closed on May 23, 2027');
    expect(spaced(card(harness))).not.toContain('This season is full');
  });

  it('shows the closed card with no link when the league has no other open season', async () => {
    vi.setSystemTime(at('2027-07-01'));
    const harness = await open();
    emit();
    await settle(harness);
    expect(spaced(card(harness))).toContain('Registration closed');
    expect(card(harness)?.querySelector('a')).toBeNull();
    expect(spaced(card(harness))).not.toContain('Registration is open for');
    expect(spaced(card(harness))).not.toContain('Register a team');
  });

  it('shows the open card, then the closed card once the deadline passes, with no new result', async () => {
    vi.setSystemTime(at('2027-05-23'));
    const harness = await open();
    emit(withUpcoming([FALL_2027]));
    await settle(harness);
    expect(spaced(card(harness))).toContain('Registration open');
    expect(host(harness).querySelector('section[aria-labelledby="how-heading"]')).not.toBeNull();

    // From 06:00 on the deadline at UTC-12 to the next change of date, 12:00 UTC the next day.
    vi.advanceTimersByTime(18 * HOUR);
    await settle(harness);

    expect(spaced(card(harness))).toContain('Registration closed');
    expect(spaced(card(harness))).toContain('Registration is open for Fall 2027.');
    expect(host(harness).querySelector('section[aria-labelledby="how-heading"]')).toBeNull();
  });

  it('shows no card and no deadline for a saved copy made before the deadline was stored', async () => {
    const saved = without(SUMMER_2027, 'registrationDeadline');
    const harness = await open();
    emit(seasonQueryResults({ season: saved }));
    await settle(harness);
    expect(card(harness)).toBeNull();
    expect(details(harness).map(([term]) => term)).toEqual(['Dates', 'Division', 'Location']);
  });
});

describe('PublicSeasonPage not found and failures', () => {
  it.each([
    ['a null season (a draft, or an unknown organization, league, or season)', { season: null }],
  ])('shows the not-found view in the public layout for %s', async (_label, options) => {
    const harness = await open();
    emit(seasonQueryResults(options));
    await settle(harness);
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(host(harness).querySelector('main nav')).toBeNull();
    expect(head().querySelector('link[rel="canonical"], meta[property^="og:"]')).toBeNull();
  });

  it.each([SEASON, TEAMS])('shows the server-error view when %s fails', async (failing) => {
    const harness = await open(`${PATH}?x=1`);
    for (const [name, value] of Object.entries(seasonQueryResults())) {
      if (name === failing) subscription(name).fail(new Error('connect ECONNREFUSED internal-db'));
      else subscription(name).emit(value);
    }
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(PATH);
    expect(host(harness).textContent).not.toContain('internal-db');
    expect(host(harness).querySelector('main nav')).toBeNull();
  });
});

const panel = (harness: RouterTestingHarness) => host(harness).querySelector('main section#teams');
const teamNames = (harness: RouterTestingHarness) =>
  [...(panel(harness)?.querySelectorAll(':scope > ul > li > span') ?? [])].map(text);

describe('PublicSeasonPage teams', () => {
  it.each([
    ['?page=2', 2],
    ['?page=0', 1],
    ['?page=abc', 1],
    ['?page=2&page=3', 1],
  ])('%s asks for teams page %s', async (query, page) => {
    await open(`${PATH}${query}`);
    expect(subscription(TEAMS).args).toEqual({
      orgSlug: 'gulf-coast-sport-social',
      leagueSlug: 'sunday-reverse-coed-4s',
      seasonSlug: 'summer-2027',
      page,
    });
  });

  it('keeps the loading view until both the season and its teams arrive, then shows the panel', async () => {
    const harness = await open();
    subscription(SEASON).emit(SUMMER_2027);
    await settle(harness);
    expect(host(harness).querySelector('main h1')).toBeNull();
    expect(host(harness).querySelector('app-public-season-skeleton')).not.toBeNull();
    subscription(TEAMS).emit(teamsPage(1));
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'Sunday Reverse Coed 4s · Summer 2027',
    );
    expect(teamNames(harness)).toEqual(TEAM_NAMES.slice(0, 5));
  });

  it('falls back to the error view when the teams never answer', async () => {
    const harness = await open();
    subscription(SEASON).emit(SUMMER_2027);
    vi.advanceTimersByTime(PAGE_LOAD_WAIT_MS);
    await settle(harness);
    expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
    expect(host(harness).querySelector('main h1')?.textContent).not.toContain('Summer 2027');
  });

  it('updates the names and the total in place when a team registers', async () => {
    const harness = await open();
    emit(seasonQueryResults({ teams: teamsPage(1, TEAM_NAMES.slice(0, 2)) }));
    await settle(harness);
    const shown = panel(harness);
    expect(text(shown?.querySelector(':scope > p'))).toBe('2 teams');

    subscription(TEAMS).emit(teamsPage(1, ['Aardvarks', ...TEAM_NAMES.slice(0, 2)]));
    await settle(harness);
    expect(panel(harness)).toBe(shown);
    expect(teamNames(harness)).toEqual(['Aardvarks', ...TEAM_NAMES.slice(0, 2)]);
    expect(text(panel(harness)?.querySelector(':scope > p'))).toBe('3 teams');

    subscription(TEAMS).emit(teamsPage(1, ['Aardvarks', ...TEAM_NAMES]));
    await settle(harness);
    expect(text(panel(harness)?.querySelector('nav p'))).toBe('1–5 of 8 teams');
  });

  it('shows the empty state before any team registers, then the first team in place', async () => {
    const harness = await open();
    emit(seasonQueryResults({ teams: NO_TEAMS }));
    await settle(harness);
    expect(spaced(panel(harness))).toBe('Teams No teams yet Teams appear here once they register.');
    subscription(TEAMS).emit(teamsPage(1, ['Block Party']));
    await settle(harness);
    expect(teamNames(harness)).toEqual(['Block Party']);
    expect(text(panel(harness)?.querySelector(':scope > p'))).toBe('1 team');
  });

  it('Next keeps page 1 shown and busy until page 2 arrives, then focuses the Teams heading and sets the canonical', async () => {
    const harness = await open();
    emit();
    await settle(harness);
    const next = [...(panel(harness)?.querySelectorAll('nav a') ?? [])].find((a) =>
      text(a).startsWith('Next'),
    ) as HTMLAnchorElement;
    next.click();
    await settle(harness);
    expect(teamNames(harness)).toEqual(TEAM_NAMES.slice(0, 5));
    expect(panel(harness)?.querySelector('ul')?.getAttribute('aria-busy')).toBe('true');

    const page2 = client.activeSubscriptions.filter((s) => s.name === TEAMS).at(-1)!;
    expect(page2.args).toMatchObject({ page: 2 });
    page2.emit(teamsPage(2));
    await settle(harness);
    expect(teamNames(harness)).toEqual(TEAM_NAMES.slice(5));
    expect(panel(harness)?.querySelector('ul')?.getAttribute('aria-busy')).toBeNull();
    expect(TestBed.inject(DOCUMENT).activeElement?.id).toBe('teams-heading');
    expect(canonical()).toMatch(/\/seasons\/summer-2027\?page=2$/);
  });
});
