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
import { PlainTestPage } from '../shell/testing/test-pages';
import { expectBadge } from '../ui/testing/badge';
import { expectBareCard } from '../ui/testing/card';
import { routerLinkState } from '../ui/testing/router-link-state';
import { OrganizationPage } from './organization-page';
import type {
  PublicCampRows,
  PublicOpenCampRows,
  PublicOrganizationPage,
} from './organization-path';
import { GULF_COAST, listPage, pagedResults, queryResults } from './testing/pages';

const CAMPS = 'camps:listPublic';
const OPEN_CAMPS = 'camps:listOpenForOrganization';
const ORG = '/organizations/gulf-coast-sport-social';
const JUNIOR_PATH = `${ORG}/camps/junior-beach-volleyball-camp`;

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

const JUNIOR: PublicCampRows[number] = {
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  sportName: 'Beach volleyball',
  minimumAge: 9,
  maximumAge: 14,
  locationNames: ['North Beach Sand Courts'],
  lastSessionEndDate: '2027-07-23',
  sessions: [
    {
      name: 'Week 1',
      startDate: '2027-07-05',
      endDate: '2027-07-09',
      registrationDeadline: '2027-07-01',
      placesLeft: 15,
    },
    {
      name: 'Week 2',
      startDate: '2027-07-19',
      endDate: '2027-07-23',
      registrationDeadline: '2027-07-15',
      placesLeft: 20,
    },
  ],
};
const SOCCER_CAMP: PublicCampRows[number] = {
  ...JUNIOR,
  name: 'Bayside Soccer Camp',
  slug: 'bayside-soccer-camp',
  sportName: 'Soccer',
  minimumAge: 8,
  maximumAge: 8,
  locationNames: [],
  lastSessionEndDate: '2027-06-25',
  sessions: [
    {
      ...JUNIOR.sessions[0],
      startDate: '2027-06-21',
      endDate: '2027-06-25',
      registrationDeadline: '2027-06-18',
    },
  ],
};
const ENDED: PublicCampRows[number] = {
  ...JUNIOR,
  name: 'Old Camp',
  lastSessionEndDate: '2027-03-31',
};

const OPEN_SESSION: PublicOpenCampRows[number] = {
  name: JUNIOR.name,
  slug: JUNIOR.slug,
  sportName: JUNIOR.sportName,
  minimumAge: 9,
  maximumAge: 14,
  locationNames: JUNIOR.locationNames,
  sessionName: 'Week 1',
  startDate: '2027-07-05',
  endDate: '2027-07-09',
  registrationDeadline: '2027-07-01',
  placesLeft: 15,
};

const withCamps = (
  camps: PublicCampRows,
  openCamps: PublicOpenCampRows = [],
): PublicOrganizationPage => ({ ...GULF_COAST, camps, openCamps });

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
const section = (harness: RouterTestingHarness) => host(harness).querySelector('#camps');
const rows = (harness: RouterTestingHarness) => [
  ...(section(harness)?.querySelectorAll(':scope > ul > li') ?? []),
];
const openSection = (harness: RouterTestingHarness) =>
  host(harness).querySelector('#registration-open');
const cards = (harness: RouterTestingHarness) => [
  ...(openSection(harness)?.querySelectorAll(':scope > ul > li') ?? []),
];
const sectionIds = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('main section')].map((el) => el.id);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-06-20'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the Camps section', () => {
  describe('the queries', () => {
    it('ask for the organization’s camps with the page from the URL only', async () => {
      await open(`${ORG}?ott=SECRET&campsPage=2&tournamentsPage=3#camps`);
      expect(
        client.activeSubscriptions
          .filter((s) => s.name.startsWith('camps:'))
          .map(({ name, args }) => ({ name, args }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      ).toEqual([
        { name: OPEN_CAMPS, args: { organizationSlug: 'gulf-coast-sport-social' } },
        { name: CAMPS, args: { organizationSlug: 'gulf-coast-sport-social', page: 2 } },
      ]);
    });

    it('treat a camps page that is not a whole number above 0 as page 1', async () => {
      for (const query of ['0', 'abc', '2&campsPage=3']) {
        TestBed.resetTestingModule();
        await open(`${ORG}?campsPage=${query}`);
        expect(subscription(CAMPS).args, query).toEqual({
          organizationSlug: 'gulf-coast-sport-social',
          page: 1,
        });
      }
    });

    it('narrow to the sport of the sport view, and send no division filter, which a camp has none of', async () => {
      await open(`${ORG}/sports/beach-volleyball?gender=womens&age=over30&campsPage=2`);
      const args = { organizationSlug: 'gulf-coast-sport-social', sport: 'beachVolleyball' };
      expect(subscription(CAMPS).args).toEqual({ ...args, page: 2 });
      expect(subscription(OPEN_CAMPS).args).toEqual(args);
    });

    it('are not asked for a segment that names no sport', async () => {
      await open(`${ORG}/sports/curling`);
      expect(client.activeSubscriptions.map((s) => s.name)).not.toContain(CAMPS);
      expect(client.activeSubscriptions.map((s) => s.name)).not.toContain(OPEN_CAMPS);
    });
  });

  describe('with upcoming camps', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      harness = await open();
      await emit(harness, queryResults(withCamps([SOCCER_CAMP, JUNIOR])));
    });

    it('sits after Leagues and before Locations, under its own heading', () => {
      expect(sectionIds(harness)).toEqual(['registration-open', 'leagues', 'camps', 'locations']);
      const heading = section(harness)?.querySelector('h2');
      expect(text(heading)).toBe('Camps');
      expect(section(harness)?.getAttribute('aria-labelledby')).toBe(heading?.id);
      expect(heading?.getAttribute('tabindex')).toBe('-1');
    });

    it('lists a row per camp in the order the query gives, each with an id to jump to', () => {
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Bayside Soccer Camp',
        'Junior Beach Volleyball Camp',
      ]);
      expect(rows(harness).map((row) => row.id)).toEqual(['camp-1', 'camp-2']);
    });

    it('shows the name as a link to the camp page, the ages, the sport and locations, and the next session’s dates', () => {
      const row = rows(harness)[1];
      const title = row.querySelector('h3 a');
      expect(title?.getAttribute('href')).toBe(JUNIOR_PATH);
      expect(text(title)).toBe('Junior Beach Volleyball Camp');
      expect(text(row.querySelector('h3 + p'))).toBe('Ages 9 to 14');
      expect(text(row.querySelector('h3 + p + p'))).toBe(
        'Beach volleyball · North Beach Sand Courts',
      );
      expect(text(row.querySelector('p:last-of-type'))).toContain('Jul 5 – Jul 9, 2027');
      expect(text(rows(harness)[0].querySelector('h3 + p'))).toBe('Age 8');
    });

    it('shows Registration open with its deadline and a Register link to the sessions', () => {
      const row = rows(harness)[1];
      expectBadge(row.querySelector('[data-slot="badge"]'), 'secondary', 'fit');
      expect([...(row.querySelector('p:last-of-type')?.children ?? [])].map(text)).toEqual([
        'Registration open',
        'Jul 5 – Jul 9, 2027 · closes Jul 1',
        'Register for Junior Beach Volleyball Camp',
      ]);
      const register = row.querySelector<HTMLAnchorElement>('a[href$="#sessions"]');
      expect(register?.getAttribute('href')).toBe(`${JUNIOR_PATH}#sessions`);
      expect(register?.className).toContain('pointer-coarse:min-h-11');
    });

    it('shows Full with no Register link when the next session has no place left', async () => {
      await emit(harness, {
        ...queryResults(withCamps([])),
        [CAMPS]: listPage([{ ...JUNIOR, sessions: [{ ...JUNIOR.sessions[0], placesLeft: 0 }] }], 1),
      });
      const row = rows(harness)[0];
      expect(text(row.querySelector('[data-slot="badge"]'))).toBe('Full');
      expect(row.querySelector('a[href$="#sessions"]')).toBeNull();
    });

    it('gives the title and the Register link the names of the camp as navigation state', () => {
      const names = {
        organization: { slug: 'gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' },
        camp: { slug: 'junior-beach-volleyball-camp', name: 'Junior Beach Volleyball Camp' },
      };
      const row = rows(harness)[1];
      expect(routerLinkState(harness.fixture, row.querySelector('h3 a'))).toEqual(names);
      expect(routerLinkState(harness.fixture, row.querySelector('a[href$="#sessions"]'))).toEqual(
        names,
      );
    });

    it('shows no page control for one page', () => {
      expect(section(harness)?.querySelector('nav')).toBeNull();
    });
  });

  describe('at the viewer’s time', () => {
    it('leaves out a camp that has ended since the query ran, and shows none when all have', async () => {
      const harness = await open();
      await emit(harness, queryResults(withCamps([ENDED, JUNIOR])));
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Junior Beach Volleyball Camp',
      ]);
      await emit(harness, { ...queryResults(withCamps([])), [CAMPS]: listPage([ENDED], 1) });
      expect(section(harness)).toBeNull();
    });

    it('moves a row to Registration closed when the date changes, with no new answer', async () => {
      const harness = await open();
      await emit(harness, queryResults(withCamps([JUNIOR])));
      expect(text(rows(harness)[0].querySelector('[data-slot="badge"]'))).toBe('Registration open');
      vi.setSystemTime(at('2027-07-02'));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      await settle(harness);
      expect(text(rows(harness)[0].querySelector('[data-slot="badge"]'))).toBe(
        'Registration closed',
      );
      expect(rows(harness)[0].querySelector('a[href$="#sessions"]')).toBeNull();
    });

    it('moves a row to the next session when the first ends, with the same answer from the query', async () => {
      const harness = await open();
      await emit(harness, queryResults(withCamps([JUNIOR])));
      expect(text(rows(harness)[0].querySelector('p:last-of-type'))).toContain(
        'Jul 5 – Jul 9, 2027 · closes Jul 1',
      );
      vi.setSystemTime(at('2027-07-09'));
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      await settle(harness);
      expect(text(rows(harness)[0].querySelector('p:last-of-type'))).toContain(
        'Jul 19 – Jul 23, 2027 · closes Jul 15',
      );
      expect(text(rows(harness)[0].querySelector('[data-slot="badge"]'))).toBe('Registration open');
      expect(rows(harness)[0].querySelector('a[href$="#sessions"]')).not.toBeNull();
      expect(client.activeSubscriptions.filter((s) => s.name === CAMPS)).toHaveLength(1);
    });
  });

  describe('with no upcoming camp', () => {
    it('shows no Camps section and leaves the sections it had', async () => {
      const harness = await open();
      await emit(harness, queryResults(withCamps([])));
      expect(section(harness)).toBeNull();
      expect(sectionIds(harness)).toEqual(['registration-open', 'leagues', 'locations']);
      expect(text(host(harness))).not.toContain('Camps');
    });
  });

  describe('with more than one page', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      ...JUNIOR,
      name: `Camp ${i + 1}`,
      slug: `camp-${i + 1}`,
    }));

    it('shows the control with links that keep the other lists and jump to the section', async () => {
      const harness = await open(`${ORG}?leagues=2&locations=2`);
      await emit(harness, {
        ...queryResults(withCamps([])),
        [CAMPS]: listPage(seven, 1),
        'organizations:listPublicLeagues': listPage(GULF_COAST.leagues, 2, 10),
        'organizations:listPublicLocations': listPage(GULF_COAST.locations, 2, 8),
      });
      const nav = section(harness)?.querySelector('nav');
      expect(nav?.getAttribute('aria-label')).toBe('Camps pages');
      expect(text(nav)).toContain('1–5 of 7');
      const hrefs = [...(nav?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain(`${ORG}?leagues=2&locations=2&campsPage=2#camps`);
    });

    it('shows the last 2 on page 2', async () => {
      const harness = await open(`${ORG}?campsPage=2`);
      await emit(harness, { ...queryResults(withCamps([])), [CAMPS]: listPage(seven, 2) });
      expect(rows(harness).map((row) => row.id)).toEqual(['camp-6', 'camp-7']);
      expect(text(section(harness)?.querySelector('nav'))).toContain('6–7 of 7');
    });

    it('counts only the camps that have not ended, and keeps a way back on a page left with none', async () => {
      const harness = await open(`${ORG}?campsPage=2`);
      await emit(harness, {
        ...queryResults(withCamps([])),
        [CAMPS]: { rows: [ENDED, { ...ENDED, slug: 'older' }], page: 2, pageCount: 2, total: 7 },
      });
      expect(rows(harness)).toHaveLength(0);
      const nav = section(harness)?.querySelector('nav');
      expect(text(nav)).toContain('0 of 6');
      const previous = [...(nav?.querySelectorAll('a') ?? [])].find((a) =>
        text(a).startsWith('Previous'),
      );
      expect(previous?.getAttribute('href')).toBe(`${ORG}#camps`);
    });
  });

  describe('the sport view', () => {
    it('names the sport in the heading and lists that sport’s camps', async () => {
      const harness = await open(`${ORG}/sports/beach-volleyball`);
      await emit(harness, pagedResults(withCamps([SOCCER_CAMP, JUNIOR]), {}, 'beach-volleyball'));
      expect(text(section(harness)?.querySelector('h2'))).toBe('Beach volleyball camps');
      expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
        'Junior Beach Volleyball Camp',
      ]);
    });

    it('shows no section for a sport with no upcoming camp', async () => {
      const harness = await open(`${ORG}/sports/softball`);
      await emit(harness, pagedResults(withCamps([SOCCER_CAMP, JUNIOR]), {}, 'softball'));
      expect(section(harness)).toBeNull();
    });
  });

  describe('a division filter', () => {
    it('leaves the camps in place, because a camp has no division to match', async () => {
      const harness = await open(`${ORG}?gender=womens`);
      await emit(harness, queryResults(withCamps([JUNIOR])));
      expect(rows(harness)).toHaveLength(1);
    });
  });

  describe('a failed query', () => {
    for (const name of [CAMPS, OPEN_CAMPS]) {
      it(`renders the server-error view when ${name} fails, until it delivers a result`, async () => {
        const harness = await open();
        const results = queryResults(withCamps([JUNIOR], [OPEN_SESSION]));
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

  it('leaves the section out until the camps answer, with the rest of the page in place', async () => {
    const harness = await open();
    const { [CAMPS]: camps, ...others } = queryResults(withCamps([JUNIOR]));
    await emit(harness, others);
    expect(host(harness).querySelector('main h1')).not.toBeNull();
    expect(section(harness)).toBeNull();
    await emit(harness, { [CAMPS]: camps });
    expect(rows(harness)).toHaveLength(1);
  });

  it('still lists the camps of an organization with no league, under the empty state', async () => {
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
        camps: [JUNIOR],
      }),
    );
    expect(text(host(harness).querySelector('main'))).toContain('No leagues yet');
    expect(rows(harness)).toHaveLength(1);
  });
});

describe('the Registration open section with camp sessions', () => {
  const SEASON_ROW = {
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-07-02',
    endDate: '2027-08-25',
    registrationDeadline: '2027-06-29',
    minimumRosterSize: 7,
    league: {
      name: 'Coed 7v7 Rec',
      slug: 'coed-7v7-rec',
      sportName: 'Soccer',
      divisionLabel: 'Coed · 7v7 · Rec',
      locationNames: ['Bayside Athletic Complex'],
    },
  };
  const WEEK_2: PublicOpenCampRows[number] = {
    ...OPEN_SESSION,
    sessionName: 'Week 2',
    startDate: '2027-07-12',
    endDate: '2027-07-16',
    registrationDeadline: '2027-07-08',
    placesLeft: 1,
  };

  it('draws a card for each open session, ordered with the seasons by deadline', async () => {
    const harness = await open();
    await emit(harness, {
      ...queryResults(withCamps([JUNIOR], [WEEK_2, OPEN_SESSION])),
      'seasons:listOpenForOrganization': [SEASON_ROW],
    });
    expect(cards(harness).map((card) => text(card.querySelector('h3')))).toEqual([
      'Coed 7v7 Rec',
      'Junior Beach Volleyball Camp',
      'Junior Beach Volleyball Camp',
    ]);
    expect(cards(harness).map((card) => text(card.querySelector('h3 + p')))).toEqual([
      'Summer 2027',
      'Week 1',
      'Week 2',
    ]);
  });

  it('draws a camp card as a season card, with the dates, ages and places, locations, and deadline', async () => {
    const harness = await open();
    await emit(harness, queryResults(withCamps([JUNIOR], [WEEK_2])));
    const card = cards(harness)[0];
    expectBareCard(card, 'flex flex-col p-5');
    expect(text(card.querySelector('[data-slot="badge"]'))).toBe('Beach volleyball');
    expect([...card.querySelectorAll('ul li')].map(text)).toEqual([
      'Jul 12 – Jul 16, 2027',
      'Ages 9 to 14, 1 place left',
      'North Beach Sand Courts',
    ]);
    expect(text(card.querySelector('p.text-sm.text-muted-foreground:not(h3 + p)'))).toBe(
      'Closes Jul 8',
    );
    const links = [...card.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      JUNIOR_PATH,
      `${JUNIOR_PATH}#sessions`,
    ]);
    expect(text(links[1])).toBe('Register for Junior Beach Volleyball Camp, Week 2');
  });

  it('leaves out a session whose deadline has passed at the viewer’s time', async () => {
    const harness = await open();
    await emit(
      harness,
      queryResults(withCamps([JUNIOR], [{ ...OPEN_SESSION, registrationDeadline: '2027-06-19' }])),
    );
    expect(cards(harness)).toHaveLength(0);
  });

  it('names the camp in the hero and the intro when only camp sessions are open', async () => {
    const harness = await open();
    await emit(harness, queryResults(withCamps([JUNIOR], [OPEN_SESSION])));
    expect(text(host(harness).querySelector('main a[href$="#registration-open"]'))).toBe(
      'Register for a camp',
    );
    expect(text(openSection(harness)?.querySelector('h2')?.nextElementSibling)).toBe(
      'Register yourself or a child for a camp session.',
    );
  });

  it('keeps the hero saying season when a season is open too', async () => {
    const harness = await open();
    await emit(harness, {
      ...queryResults(withCamps([JUNIOR], [OPEN_SESSION])),
      'seasons:listOpenForOrganization': [SEASON_ROW],
    });
    expect(text(host(harness).querySelector('main a[href$="#registration-open"]'))).toBe(
      'Register for a season',
    );
    expect(text(openSection(harness)?.querySelector('h2')?.nextElementSibling)).toBe(
      'Register a team for a season, or yourself or a child for a camp session.',
    );
  });

  it('shows the skeleton until the seasons, the tournaments, and the camps have all answered', async () => {
    const harness = await open();
    const { [OPEN_CAMPS]: held, ...others } = queryResults(withCamps([JUNIOR], [OPEN_SESSION]));
    await emit(harness, others);
    expect(openSection(harness)?.querySelector('app-open-seasons-skeleton')).not.toBeNull();
    await emit(harness, { [OPEN_CAMPS]: held });
    expect(openSection(harness)?.querySelector('app-open-seasons-skeleton')).toBeNull();
    expect(cards(harness)).toHaveLength(1);
  });

  it('shows the camp sessions of an organization with no league, with the hero button', async () => {
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
        camps: [JUNIOR],
        openCamps: [OPEN_SESSION],
      }),
    );
    expect(cards(harness)).toHaveLength(1);
    expect(text(host(harness).querySelector('main a[href$="#registration-open"]'))).toBe(
      'Register for a camp',
    );
  });
});

describe('the Camps section offline', () => {
  const NOW = Date.UTC(2027, 5, 20, 14, 30);
  const SAVED_AT = Date.UTC(2027, 5, 19, 2, 14);

  function plant(page: PublicOrganizationPage, withCampCopies: boolean): void {
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
      ...(withCampCopies
        ? ([
            [api.camps.listPublic, { organizationSlug: page.slug, page: 1 }, CAMPS],
            [api.camps.listOpenForOrganization, { organizationSlug: page.slug }, OPEN_CAMPS],
          ] as const)
        : []),
    ] as const;
    for (const [fn, args, name] of planted) plantSavedCopy(fn, args, results[name], SAVED_AT);
  }

  beforeEach(() => {
    vi.setSystemTime(NOW);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  });

  it('shows the camps and the open camp sessions from the saved copies', async () => {
    plant(withCamps([JUNIOR], [OPEN_SESSION]), true);
    const harness = await open();
    expect(rows(harness).map((row) => text(row.querySelector('h3')))).toEqual([
      'Junior Beach Volleyball Camp',
    ]);
    expect(cards(harness)).toHaveLength(1);
    expect(host(harness).querySelector('app-saved-copy-note')).not.toBeNull();
  });

  it('opens a page saved before the camp lists existed, with none', async () => {
    plant(withCamps([JUNIOR], [OPEN_SESSION]), false);
    const harness = await open();
    expect(host(harness).querySelector('main h1')).not.toBeNull();
    expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    expect(section(harness)).toBeNull();
  });

  it('shows the not-saved view for a later camps page that was never saved', async () => {
    plant(withCamps([JUNIOR], [OPEN_SESSION]), true);
    const harness = await open(`${ORG}?campsPage=2`);
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
  });
});
