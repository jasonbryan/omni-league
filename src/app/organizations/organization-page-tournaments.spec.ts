import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { api } from '../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../core/data/convex/testing/saved-copy';
import { formatSavedTime } from '../offline/saved-time';
import { PlainTestPage } from '../shell/testing/test-pages';
import { expectBadge } from '../ui/testing/badge';
import { expectBareCard } from '../ui/testing/card';
import { routerLinkState } from '../ui/testing/router-link-state';
import { OrganizationPage } from './organization-page';
import type {
  PublicOpenTournamentRows,
  PublicOrganizationPage,
  PublicTournamentRows,
} from './organization-path';
import {
  GULF_COAST,
  listPage,
  pagedResults,
  queryResults,
  sportQueryResults,
} from './testing/pages';

const TOURNAMENTS = 'tournaments:listPublic';
const OPEN_TOURNAMENTS = 'tournaments:listOpenForOrganization';
const ORG = '/organizations/gulf-coast-sport-social';

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

const BEACH_OPEN: PublicTournamentRows[number] = {
  name: 'Gulf Coast Beach Open',
  slug: 'gulf-coast-beach-open',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locationNames: ['North Beach Sand Courts'],
  startDate: '2027-05-15',
  endDate: '2027-05-16',
  registrationDeadline: '2027-05-08',
};
const SOCCER_CUP: PublicTournamentRows[number] = {
  name: 'Bayside Soccer Cup',
  slug: 'bayside-soccer-cup',
  sportName: 'Soccer',
  divisionLabel: 'Coed · 7v7 · Rec',
  locationNames: ['Bayside Athletic Complex'],
  startDate: '2027-04-10',
  endDate: '2027-04-11',
  registrationDeadline: '2027-03-20',
};
const IN_PROGRESS: PublicTournamentRows[number] = {
  name: 'Spring Slam',
  slug: 'spring-slam',
  sportName: 'Beach volleyball',
  divisionLabel: 'Men · 4v4 · A',
  locationNames: [],
  startDate: '2027-03-30',
  endDate: '2027-04-02',
  registrationDeadline: '2027-03-23',
};
const ENDED: PublicTournamentRows[number] = {
  name: 'Winter Classic',
  slug: 'winter-classic',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locationNames: [],
  startDate: '2027-03-01',
  endDate: '2027-03-02',
  registrationDeadline: '2027-02-22',
};

const withTournaments = (
  tournaments: PublicTournamentRows,
  openTournaments: PublicOpenTournamentRows = [],
): PublicOrganizationPage => ({ ...GULF_COAST, tournaments, openTournaments });

const OPEN_ROW: PublicOpenTournamentRows[number] = { ...BEACH_OPEN, minimumRosterSize: 2 };

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
  await settle(harness);
  return harness;
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function emit(
  harness: RouterTestingHarness,
  results: Record<string, unknown>,
): Promise<void> {
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
  await settle(harness);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const section = (harness: RouterTestingHarness) => host(harness).querySelector('#tournaments');
const rows = (harness: RouterTestingHarness) => [
  ...(section(harness)?.querySelectorAll(':scope > ul > li') ?? []),
];
const heroPlaceholder = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLElement>('[data-hero-actions] > span[aria-hidden="true"]');
const openSection = (harness: RouterTestingHarness) =>
  host(harness).querySelector('#registration-open');
const sectionIds = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('main section')].map((el) => el.id);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-04-01'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the Tournaments section', () => {
  describe('the queries', () => {
    it('ask for the organization’s tournaments with the page from the URL only', async () => {
      await open(`${ORG}?ott=SECRET&tournamentsPage=2&leagues=3#tournaments`);
      expect(
        client.activeSubscriptions
          .filter((s) => s.name.startsWith('tournaments:'))
          .map(({ name, args }) => ({ name, args }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      ).toEqual([
        { name: OPEN_TOURNAMENTS, args: { organizationSlug: 'gulf-coast-sport-social' } },
        { name: TOURNAMENTS, args: { organizationSlug: 'gulf-coast-sport-social', page: 2 } },
      ]);
    });

    it('treat a tournaments page that is not a whole number above 0 as page 1', async () => {
      for (const query of ['0', 'abc', '2&tournamentsPage=3']) {
        TestBed.resetTestingModule();
        await open(`${ORG}?tournamentsPage=${query}`);
        expect(subscription(TOURNAMENTS).args, query).toEqual({
          organizationSlug: 'gulf-coast-sport-social',
          page: 1,
        });
      }
    });

    it('narrow to the sport of the sport view and to the division filters', async () => {
      await open(`${ORG}/sports/beach-volleyball?gender=womens&age=over30&tournamentsPage=2`);
      const args = {
        organizationSlug: 'gulf-coast-sport-social',
        sport: 'beachVolleyball',
        gender: ['womens'],
        ageGroup: ['over30'],
      };
      expect(subscription(TOURNAMENTS).args).toEqual({ ...args, page: 2 });
      expect(subscription(OPEN_TOURNAMENTS).args).toEqual(args);
    });

    it('are not asked for a segment that names no sport', async () => {
      await open(`${ORG}/sports/curling`);
      expect(client.activeSubscriptions.map((s) => s.name)).not.toContain(TOURNAMENTS);
      expect(client.activeSubscriptions.map((s) => s.name)).not.toContain(OPEN_TOURNAMENTS);
    });
  });

  describe('with upcoming tournaments', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      harness = await open();
      await emit(harness, queryResults(withTournaments([SOCCER_CUP, BEACH_OPEN])));
    });

    it('sits after Leagues and before Locations, under its own heading', () => {
      expect(sectionIds(harness)).toEqual([
        'registration-open',
        'leagues',
        'tournaments',
        'locations',
      ]);
      const heading = section(harness)?.querySelector('h2');
      expect(text(heading)).toBe('Tournaments');
      expect(section(harness)?.getAttribute('aria-labelledby')).toBe(heading?.id);
      expect(heading?.getAttribute('tabindex')).toBe('-1');
    });

    it('lists a row per tournament in the order the query gives', () => {
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Bayside Soccer Cup',
        'Gulf Coast Beach Open',
      ]);
    });

    it('shows the name as a link to the tournament page, the division, the sport and locations, and the dates', () => {
      const row = rows(harness)[1];
      const title = row.querySelector('h3 a');
      expect(title?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open',
      );
      expect(text(title)).toBe('Gulf Coast Beach Open');
      expect(text(row.querySelector('h3 + p'))).toBe('Coed · 2v2 · Open');
      expect(text(row.querySelector('h3 + p + p'))).toBe(
        'Beach volleyball · North Beach Sand Courts',
      );
      expect(text(row.querySelector('p:last-of-type'))).toContain('May 15 – May 16, 2027');
    });

    it('gives each row an id to jump to', () => {
      expect(rows(harness).map((row) => row.id)).toEqual(['tournament-1', 'tournament-2']);
    });

    it('shows Registration open with its deadline and a Register link to the registration card', () => {
      const row = rows(harness)[1];
      expectBadge(row.querySelector('[data-slot="badge"]'), 'secondary', 'fit');
      expect(text(row.querySelector('[data-slot="badge"]'))).toBe('Registration open');
      expect([...(row.querySelector('p:last-of-type')?.children ?? [])].map(text)).toEqual([
        'Registration open',
        'May 15 – May 16, 2027 · closes May 8',
        'Register for Gulf Coast Beach Open',
      ]);
      const register = row.querySelector<HTMLAnchorElement>('a[href$="#registration"]');
      expect(register?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open#registration',
      );
      expect(text(register)).toBe('Register for Gulf Coast Beach Open');
      expect(register?.className).toContain('pointer-coarse:min-h-11');
    });

    it('shows Registration closed with no Register link after the deadline', () => {
      const row = rows(harness)[0];
      expectBadge(row.querySelector('[data-slot="badge"]'), 'muted', 'fit');
      expect(text(row.querySelector('[data-slot="badge"]'))).toBe('Registration closed');
      expect(row.querySelector('a[href$="#registration"]')).toBeNull();
    });

    it('gives the title and the Register link the names of the tournament as navigation state', () => {
      const names = {
        organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
        tournament: { slug: 'gulf-coast-beach-open', name: 'Gulf Coast Beach Open' },
      };
      const row = rows(harness)[1];
      expect(routerLinkState(harness.fixture, row.querySelector('h3 a'))).toEqual(names);
      expect(
        routerLinkState(harness.fixture, row.querySelector('a[href$="#registration"]')),
      ).toEqual(names);
    });

    it('shows no page control for one page', () => {
      expect(section(harness)?.querySelector('nav')).toBeNull();
    });
  });

  describe('the status of each row at the viewer’s time', () => {
    it('says In progress on the days of the tournament, and leaves out one that has ended since the query ran', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTournaments([ENDED, IN_PROGRESS, BEACH_OPEN])));
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Spring Slam',
        'Gulf Coast Beach Open',
      ]);
      const badge = rows(harness)[0].querySelector('[data-slot="badge"]');
      expect(text(badge)).toBe('In progress');
      expectBadge(badge, 'muted', 'fit');
    });

    it('shows no section when every row has ended', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTournaments([ENDED])));
      expect(section(harness)).toBeNull();
    });

    it('moves a row to Registration closed when the date changes, with no new answer', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTournaments([BEACH_OPEN])));
      expect(text(rows(harness)[0].querySelector('[data-slot="badge"]'))).toBe('Registration open');
      vi.setSystemTime(at('2027-05-09'));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      await settle(harness);
      expect(text(rows(harness)[0].querySelector('[data-slot="badge"]'))).toBe(
        'Registration closed',
      );
      expect(rows(harness)[0].querySelector('a[href$="#registration"]')).toBeNull();
    });
  });

  describe('the page control after a date change drops rows the query still counts', () => {
    const live = (n: number) => ({ ...BEACH_OPEN, name: `Open ${n}`, slug: `open-${n}` });

    it('counts only the rows that have not ended, and keeps the range of the page', async () => {
      const harness = await open();
      await emit(harness, {
        ...queryResults(withTournaments([])),
        [TOURNAMENTS]: {
          rows: [ENDED, live(1), live(2), live(3), live(4)],
          page: 1,
          pageCount: 2,
          total: 7,
        },
      });
      expect(rows(harness)).toHaveLength(4);
      expect(text(section(harness)?.querySelector('nav'))).toContain('1–5 of 6');
    });

    it('drops the control when the rows that remain fit one page', async () => {
      const harness = await open();
      await emit(harness, {
        ...queryResults(withTournaments([])),
        [TOURNAMENTS]: {
          rows: [ENDED, live(1), live(2), live(3), live(4)],
          page: 1,
          pageCount: 2,
          total: 6,
        },
      });
      expect(section(harness)?.querySelector('nav')).toBeNull();
    });

    it('keeps the section and a way back when every row of a later page has ended', async () => {
      const harness = await open(`${ORG}?tournamentsPage=2`);
      await emit(harness, {
        ...queryResults(withTournaments([])),
        [TOURNAMENTS]: {
          rows: [ENDED, { ...ENDED, name: 'Winter Cup', slug: 'winter-cup' }],
          page: 2,
          pageCount: 2,
          total: 7,
        },
      });
      expect(rows(harness)).toHaveLength(0);
      const nav = section(harness)?.querySelector('nav');
      expect(nav).not.toBeNull();
      const previous = [...(nav?.querySelectorAll('a') ?? [])].find((a) =>
        text(a).startsWith('Previous'),
      );
      expect(previous?.getAttribute('href')).toBe(`${ORG}#tournaments`);
    });
  });

  describe('with no upcoming tournament', () => {
    it('shows no Tournaments section and leaves the sections it had', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTournaments([])));
      expect(section(harness)).toBeNull();
      expect(sectionIds(harness)).toEqual(['registration-open', 'leagues', 'locations']);
      expect(text(host(harness))).not.toContain('Tournaments');
    });
  });

  describe('with more than one page', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      ...BEACH_OPEN,
      name: `Open ${i + 1}`,
      slug: `open-${i + 1}`,
    }));

    it('shows the page control with links that keep the other lists and jump to the section', async () => {
      const harness = await open(`${ORG}?leagues=2&locations=2`);
      await emit(harness, {
        ...queryResults(withTournaments([])),
        [TOURNAMENTS]: listPage(seven, 1),
        'organizations:listPublicLeagues': listPage(GULF_COAST.leagues, 2, 10),
        'organizations:listPublicLocations': listPage(GULF_COAST.locations, 2, 8),
      });
      const nav = section(harness)?.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Tournaments pages');
      expect(text(nav)).toContain('1–5 of 7');
      const hrefs = [...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain(`${ORG}?leagues=2&locations=2&tournamentsPage=2#tournaments`);
    });

    it('shows the last 2 on page 2', async () => {
      const harness = await open(`${ORG}?tournamentsPage=2`);
      await emit(harness, {
        ...queryResults(withTournaments([])),
        [TOURNAMENTS]: listPage(seven, 2),
      });
      expect(rows(harness).map((row) => row.id)).toEqual(['tournament-6', 'tournament-7']);
      expect(text(section(harness)?.querySelector('nav'))).toContain('6–7 of 7');
    });

    it('keeps the tournaments page in the links of the other lists', async () => {
      const harness = await open(`${ORG}?tournamentsPage=2`);
      await emit(harness, {
        ...queryResults(withTournaments([])),
        [TOURNAMENTS]: listPage(seven, 2),
        'organizations:listPublicLeagues': {
          rows: GULF_COAST.leagues,
          page: 1,
          pageCount: 2,
          total: 10,
        },
      });
      const hrefs = [...host(harness).querySelectorAll('#leagues nav a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toContain(`${ORG}?leagues=2&tournamentsPage=2#leagues`);
    });
  });

  describe('loading', () => {
    it('leaves the section out until the tournaments answer, with the rest of the page in place', async () => {
      const harness = await open();
      const { [TOURNAMENTS]: tournaments, ...others } = queryResults(withTournaments([BEACH_OPEN]));
      await emit(harness, others);
      expect(host(harness).querySelector('main h1')).not.toBeNull();
      expect(section(harness)).toBeNull();
      expect(host(harness).querySelector('app-organization-skeleton')).toBeNull();
      await emit(harness, { [TOURNAMENTS]: tournaments });
      expect(rows(harness)).toHaveLength(1);
    });

    it('shows the page with the open seasons loading while only the open tournaments are missing', async () => {
      const harness = await open();
      const results = queryResults(withTournaments([BEACH_OPEN]));
      await emit(
        harness,
        Object.fromEntries(Object.entries(results).filter(([name]) => name !== OPEN_TOURNAMENTS)),
      );
      expect(host(harness).querySelector('main h1')).not.toBeNull();
      expect(section(harness)).not.toBeNull();
      expect(openSection(harness)?.querySelector('app-open-seasons-skeleton')).not.toBeNull();
    });

    it('keeps the rows of the sport it leaves while the tournaments of the next sport load', async () => {
      const harness = await open(`${ORG}/sports/beach-volleyball`);
      await emit(harness, queryResults(withTournaments([BEACH_OPEN])));
      expect(rows(harness)).toHaveLength(1);
      await harness.navigateByUrl(`${ORG}/sports/soccer`);
      await settle(harness);
      expect(host(harness).querySelector('main h1')).not.toBeNull();
      expect(rows(harness)).toHaveLength(1);
      expect(section(harness)?.querySelector('ul')?.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('a failed query', () => {
    for (const name of [TOURNAMENTS, OPEN_TOURNAMENTS]) {
      it(`renders the server-error view when ${name} fails, until it delivers a result`, async () => {
        const harness = await open();
        const results = queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW]));
        for (const [other, value] of Object.entries(results)) {
          if (other !== name) subscription(other).emit(value);
        }
        subscription(name).fail(new Error('down'));
        await settle(harness);
        expect(host(harness).querySelector('app-server-error-view')).not.toBeNull();
        subscription(name).emit(results[name]);
        await settle(harness);
        expect(host(harness).querySelector('app-server-error-view')).toBeNull();
        expect(section(harness)).not.toBeNull();
      });
    }
  });

  describe('the sport view', () => {
    it('names the sport in the heading and lists that sport’s tournaments', async () => {
      const harness = await open(`${ORG}/sports/beach-volleyball`);
      await emit(
        harness,
        pagedResults(withTournaments([SOCCER_CUP, BEACH_OPEN]), {}, 'beach-volleyball'),
      );
      expect(text(section(harness)?.querySelector('h2'))).toBe('Beach volleyball tournaments');
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Gulf Coast Beach Open',
      ]);
    });

    it('shows no section for a sport with no upcoming tournament', async () => {
      const harness = await open(`${ORG}/sports/softball`);
      await emit(harness, pagedResults(withTournaments([SOCCER_CUP, BEACH_OPEN]), {}, 'softball'));
      expect(section(harness)).toBeNull();
    });
  });

  describe('the organization with no league', () => {
    it('still lists its tournaments under the empty state', async () => {
      const harness = await open();
      await emit(
        harness,
        queryResults({
          ...GULF_COAST,
          leagueCount: 0,
          sportCount: 0,
          sports: [],
          leagues: [],
          locations: [],
          locationCount: 0,
          tournaments: [BEACH_OPEN],
        }),
      );
      expect(text(host(harness).querySelector('main'))).toContain('No leagues yet');
      expect(rows(harness)).toHaveLength(1);
    });
  });
});

describe('the Registration open section with tournaments', () => {
  const SEASON_ROW = {
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-02',
    endDate: '2027-08-25',
    registrationDeadline: '2027-05-19',
    minimumRosterSize: 7,
    league: {
      name: 'Coed 7v7 Rec',
      slug: 'coed-7v7-rec',
      sportName: 'Soccer',
      divisionLabel: 'Coed · 7v7 · Rec',
      locationNames: ['Bayside Athletic Complex'],
    },
  };
  const EARLY_SEASON = {
    ...SEASON_ROW,
    name: 'Spring 2027',
    slug: 'spring-2027',
    registrationDeadline: '2027-04-20',
    startDate: '2027-05-04',
  };
  const cards = (harness: RouterTestingHarness) => [
    ...(openSection(harness)?.querySelectorAll(':scope > ul > li') ?? []),
  ];

  it('orders the open tournaments and the open seasons together by deadline', async () => {
    const harness = await open();
    await emit(harness, {
      ...queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])),
      'seasons:listOpenForOrganization': [SEASON_ROW, EARLY_SEASON],
    });
    expect(cards(harness).map((card) => text(card.querySelector('h3')))).toEqual([
      'Coed 7v7 Rec',
      'Gulf Coast Beach Open',
      'Coed 7v7 Rec',
    ]);
    expect(cards(harness).map((card) => text(card.querySelector('h3 + p')))).toEqual([
      'Spring 2027',
      'Tournament',
      'Summer 2027',
    ]);
  });

  it('draws a tournament card as a season card, with the dates, division and team size, locations, and deadline', async () => {
    const harness = await open();
    await emit(harness, queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])));
    const card = cards(harness)[0];
    expectBareCard(card, 'flex flex-col p-5');
    expect(text(card.querySelector('[data-slot="badge"]'))).toBe('Beach volleyball');
    expect([...card.querySelectorAll('ul li')].map(text)).toEqual([
      'May 15 – May 16, 2027',
      'Coed · 2v2 · Open, teams of at least 2',
      'North Beach Sand Courts',
    ]);
    expect(text(card.querySelector('p.text-sm.text-muted-foreground:not(h3 + p)'))).toBe(
      'Closes May 8',
    );
    const links = [...card.querySelectorAll('a')];
    const href = '/organizations/gulf-coast-sport-social/tournaments/gulf-coast-beach-open';
    expect(links.map((a) => a.getAttribute('href'))).toEqual([href, `${href}#registration`]);
    expect(text(links[1])).toBe('Register for Gulf Coast Beach Open');
  });

  it('leaves out an open tournament whose deadline has passed at the viewer’s time', async () => {
    const harness = await open();
    await emit(
      harness,
      queryResults(withTournaments([], [{ ...OPEN_ROW, registrationDeadline: '2027-03-31' }])),
    );
    expect(cards(harness)).toHaveLength(0);
    expect(text(openSection(harness))).toContain('No season is open for registration right now');
  });

  it('shows the section with only a tournament open, and the hero says tournament', async () => {
    const harness = await open();
    await emit(harness, queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])));
    expect(cards(harness)).toHaveLength(1);
    const hero = host(harness).querySelector('main a[href$="#registration-open"]');
    expect(text(hero)).toBe('Register for a tournament');
  });

  it('keeps the hero saying season when a season is open', async () => {
    const harness = await open();
    await emit(harness, {
      ...queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])),
      'seasons:listOpenForOrganization': [SEASON_ROW],
    });
    expect(text(host(harness).querySelector('main a[href$="#registration-open"]'))).toBe(
      'Register for a season',
    );
  });

  describe('the intro', () => {
    const intro = (harness: RouterTestingHarness) =>
      text(openSection(harness)?.querySelector('h2')?.nextElementSibling);

    it('offers free agents only when every open card is a season', async () => {
      const harness = await open();
      await emit(harness, {
        ...queryResults(withTournaments([])),
        'seasons:listOpenForOrganization': [SEASON_ROW],
      });
      expect(intro(harness)).toBe(
        'Register a team, or register as a free agent and an organizer places you on one.',
      );
    });

    it('offers a team for a tournament when only tournaments are open', async () => {
      const harness = await open();
      await emit(harness, queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])));
      expect(intro(harness)).toBe('Register a team for a tournament.');
    });

    it('offers no free agent registration when a season and a tournament are both open', async () => {
      const harness = await open();
      await emit(harness, {
        ...queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])),
        'seasons:listOpenForOrganization': [SEASON_ROW],
      });
      expect(intro(harness)).toBe('Register a team for a season or a tournament.');
      expect(text(openSection(harness))).not.toContain('free agent');
    });
  });

  describe('an open tournament when no league shows', () => {
    const NO_LEAGUE: PublicOrganizationPage = {
      ...GULF_COAST,
      leagueCount: 0,
      sportCount: 0,
      sports: [],
      leagues: [],
      locations: [],
      locationCount: 0,
    };

    it('shows the section and the hero button for an organization with no league', async () => {
      const harness = await open();
      await emit(
        harness,
        queryResults({ ...NO_LEAGUE, tournaments: [BEACH_OPEN], openTournaments: [OPEN_ROW] }),
      );
      expect(cards(harness).map((card) => text(card.querySelector('h3')))).toEqual([
        'Gulf Coast Beach Open',
      ]);
      expect(text(host(harness).querySelector('main a[href$="#registration-open"]'))).toBe(
        'Register for a tournament',
      );
    });

    it('shows no section for such an organization when no tournament is open', async () => {
      const harness = await open();
      await emit(harness, queryResults({ ...NO_LEAGUE, tournaments: [BEACH_OPEN] }));
      expect(openSection(harness)).toBeNull();
      expect(host(harness).querySelector('main a[href$="#registration-open"]')).toBeNull();
    });

    it('shows the tournaments that match a filter that no league matches, and none of the seasons', async () => {
      const harness = await open(`${ORG}?gender=womens`);
      await emit(harness, {
        ...queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])),
        'organizations:listPublicLeagues': { rows: [], page: 1, pageCount: 0, total: 0 },
        'seasons:listOpenForOrganization': [SEASON_ROW],
      });
      expect(text(host(harness).querySelector('#leagues'))).toContain('No leagues match');
      expect(cards(harness).map((card) => text(card.querySelector('h3')))).toEqual([
        'Gulf Coast Beach Open',
      ]);
      expect(text(host(harness).querySelector('main a[href$="#registration-open"]'))).toBe(
        'Register for a tournament',
      );
    });

    it('shows no section for a filter that no league and no tournament matches', async () => {
      const harness = await open(`${ORG}?gender=womens`);
      await emit(harness, {
        ...queryResults(withTournaments([], [])),
        'organizations:listPublicLeagues': { rows: [], page: 1, pageCount: 0, total: 0 },
        'seasons:listOpenForOrganization': [SEASON_ROW],
      });
      expect(openSection(harness)).toBeNull();
    });
  });

  describe('the hero placeholder while the open cards load', () => {
    async function loadingAfter(first: Record<string, unknown>) {
      const harness = await open();
      await emit(harness, first);
      await harness.navigateByUrl(`${ORG}/sports/beach-volleyball`);
      await settle(harness);
      const results = sportQueryResults(
        withTournaments([BEACH_OPEN], [OPEN_ROW]),
        'beach-volleyball',
      );
      for (const name of Object.keys(results).filter(
        (key) => key !== OPEN_TOURNAMENTS && key !== 'seasons:listOpenForOrganization',
      )) {
        subscription(name).emit(results[name]);
      }
      await settle(harness);
      return harness;
    }

    it('holds the tournament label when the cards last seen were tournaments only', async () => {
      const harness = await loadingAfter(queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])));
      expect(text(heroPlaceholder(harness))).toBe('Register for a tournament');
    });

    it('holds the season label when a season was among the cards last seen', async () => {
      const harness = await loadingAfter({
        ...queryResults(withTournaments([BEACH_OPEN], [OPEN_ROW])),
        'seasons:listOpenForOrganization': [SEASON_ROW],
      });
      expect(text(heroPlaceholder(harness))).toBe('Register for a season');
    });
  });

  it('shows the skeleton until both the seasons and the tournaments have answered', async () => {
    const harness = await open();
    const { [OPEN_TOURNAMENTS]: held, ...others } = queryResults(withTournaments([], [OPEN_ROW]));
    await emit(harness, others);
    expect(openSection(harness)?.querySelector('app-open-seasons-skeleton')).not.toBeNull();
    await emit(harness, { [OPEN_TOURNAMENTS]: held });
    expect(openSection(harness)?.querySelector('app-open-seasons-skeleton')).toBeNull();
    expect(cards(harness)).toHaveLength(1);
  });
});

describe('the Tournaments section offline', () => {
  const NOW = Date.UTC(2027, 3, 1, 14, 30);
  const SAVED_AT = Date.UTC(2027, 2, 31, 2, 14);

  function stubOnLine(value: boolean): void {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
  }

  function plant(page: PublicOrganizationPage, withTournamentCopies: boolean): void {
    const results = queryResults(page);
    const planted = [
      [api.organizations.getPublicPage, { slug: page.slug }, 'organizations:getPublicPage'],
      [
        api.organizations.listPublicLeagues,
        { slug: page.slug, page: 1 },
        'organizations:listPublicLeagues',
      ],
      [
        api.organizations.listPublicLocations,
        { slug: page.slug, page: 1 },
        'organizations:listPublicLocations',
      ],
      [
        api.seasons.listOpenForOrganization,
        { orgSlug: page.slug },
        'seasons:listOpenForOrganization',
      ],
      ...(withTournamentCopies
        ? ([
            [api.tournaments.listPublic, { organizationSlug: page.slug, page: 1 }, TOURNAMENTS],
            [
              api.tournaments.listOpenForOrganization,
              { organizationSlug: page.slug },
              OPEN_TOURNAMENTS,
            ],
          ] as const)
        : []),
    ] as const;
    for (const [fn, args, name] of planted) plantSavedCopy(fn, args, results[name], SAVED_AT);
  }

  beforeEach(() => {
    vi.setSystemTime(NOW);
    stubOnLine(false);
  });

  it('shows the tournaments and the open tournaments from the saved copies', async () => {
    plant(withTournaments([BEACH_OPEN], [OPEN_ROW]), true);
    const harness = await open();
    expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
      'Gulf Coast Beach Open',
    ]);
    expect(
      [...(openSection(harness)?.querySelectorAll(':scope > ul > li h3') ?? [])].map(text),
    ).toEqual(['Gulf Coast Beach Open']);
    expect(host(harness).querySelector('app-saved-copy-note')).not.toBeNull();
  });

  it('opens a page saved before the tournament lists existed, with none', async () => {
    plant(withTournaments([BEACH_OPEN], [OPEN_ROW]), false);
    const harness = await open();
    expect(host(harness).querySelector('main h1')).not.toBeNull();
    expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    expect(section(harness)).toBeNull();
  });

  it('shows the not-saved view for a later tournaments page that was never saved', async () => {
    plant(withTournaments([BEACH_OPEN], [OPEN_ROW]), true);
    const harness = await open(`${ORG}?tournamentsPage=2`);
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(section(harness)).toBeNull();
  });

  it('dates the note by the oldest copy, the tournament lists included', async () => {
    plant(withTournaments([BEACH_OPEN], [OPEN_ROW]), false);
    plantSavedCopy(
      api.tournaments.listPublic,
      { organizationSlug: GULF_COAST.slug, page: 1 },
      queryResults(withTournaments([BEACH_OPEN]))[TOURNAMENTS],
      SAVED_AT - 60 * 60 * 1000,
    );
    const harness = await open();
    expect(text(host(harness).querySelector('app-saved-copy-note'))).toContain(
      formatSavedTime(SAVED_AT - 60 * 60 * 1000, NOW).text,
    );
  });
});
