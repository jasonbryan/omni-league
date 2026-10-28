import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import type { PublicOpenSeasonRows, PublicOrganizationPage } from './organization-path';
import { MUTED_BADGE, OPEN_BADGE } from './season-status';
import { GULF_COAST, queryResults, sportQueryResults } from './testing/pages';

const OPEN_SEASONS = 'seasons:listOpenForOrganization';
const ORG = '/organizations/gulf-coast-sport-social';
const HOUR = 60 * 60 * 1000;

// 18:00 UTC is 06:00 on that date at UTC-12.
const at = (date: string) => Date.parse(`${date}T18:00:00Z`);

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
const section = (harness: RouterTestingHarness) =>
  host(harness).querySelector('#registration-open');
const heroLink = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLAnchorElement>('main a[href$="#registration-open"]');
const classes = (value: Element | string) =>
  (typeof value === 'string' ? value : value.className).split(' ').sort();
const rowStatus = (harness: RouterTestingHarness, n: number) =>
  [...(host(harness).querySelector(`#league-${n} p:last-of-type`)?.children ?? [])].map(text);
const COED_7V7 = {
  name: 'Coed 7v7 Rec',
  slug: 'coed-7v7-rec',
  sportName: 'Soccer',
  divisionLabel: 'Coed · 7v7 · Rec',
  locationNames: ['Bayside Athletic Complex'],
};
const SUNDAY_4S = {
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 4v4 · BB',
  locationNames: ['North Beach Sand Courts'],
};

const SUMMER_7V7 = {
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-02',
  endDate: '2027-08-25',
  registrationDeadline: '2027-05-19',
};
const SUMMER_4S = {
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
};

// The query returns the latest deadline first; the page reorders them.
const OPEN: PublicOpenSeasonRows = [
  { ...SUMMER_4S, minimumRosterSize: 4, league: SUNDAY_4S },
  { ...SUMMER_7V7, minimumRosterSize: 7, league: COED_7V7 },
  {
    name: 'Spring 2027',
    slug: 'spring-2027',
    startDate: '2027-04-04',
    endDate: '2027-05-30',
    registrationDeadline: '2027-03-01',
    minimumRosterSize: 4,
    league: { ...SUNDAY_4S, locationNames: [] },
  },
];

function withSeasons(open: PublicOpenSeasonRows): PublicOrganizationPage {
  const leagues = structuredClone(GULF_COAST.leagues);
  leagues[0].seasons = [SUMMER_7V7];
  leagues[2].seasons = [
    SUMMER_4S,
    {
      name: 'Fall 2026',
      slug: 'fall-2026',
      startDate: '2026-09-01',
      endDate: '2026-12-01',
      registrationDeadline: '2026-08-15',
    },
  ];
  leagues[3].seasons = [
    {
      name: 'Spring 2027',
      slug: 'spring-2027',
      startDate: '2027-03-01',
      endDate: '2027-05-30',
      registrationDeadline: '2027-02-15',
    },
  ];
  leagues[4].seasons = [
    {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-02',
      endDate: '2027-08-25',
      registrationDeadline: '2027-03-20',
    },
  ];
  return { ...GULF_COAST, leagues, openSeasons: open };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(at('2027-04-01'));
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('the Registration open section', () => {
  describe('with open seasons', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      harness = await open();
      await emit(harness, queryResults(withSeasons(OPEN.slice(0, 2))));
    });

    it('sits above Leagues, with its heading and the line about teams and free agents', () => {
      const sections = [...host(harness).querySelectorAll('main section')].map((el) => el.id);
      expect(sections.slice(0, 3)).toEqual(['registration-open', 'leagues', 'locations']);
      expect(text(section(harness)?.querySelector('h2'))).toBe('Registration open');
      expect(text(section(harness)?.querySelector('h2')?.nextElementSibling)).toBe(
        'Register a team, or register as a free agent and an organizer places you on one.',
      );
    });

    it('shows one card per open season, the soonest deadline first', () => {
      const cards = [...(section(harness)?.querySelectorAll(':scope > ul > li') ?? [])];
      expect(cards.map((card) => text(card.querySelector('h3')))).toEqual([
        'Coed 7v7 Rec',
        'Sunday Reverse Coed 4s',
      ]);
    });

    it('shows the sport, league, season, dates, division and team size, locations, and deadline', () => {
      const card = section(harness)?.querySelector(':scope > ul > li');
      expect(text(card?.querySelector('[data-slot="badge"]'))).toBe('Soccer');
      expect(text(card?.querySelector('h3'))).toBe('Coed 7v7 Rec');
      expect(text(card?.querySelector('h3 + p'))).toBe('Summer 2027');
      expect([...(card?.querySelectorAll('ul li') ?? [])].map(text)).toEqual([
        'Jun 2 – Aug 25, 2027',
        'Coed · 7v7 · Rec, teams of at least 7',
        'Bayside Athletic Complex',
      ]);
      expect(text(card?.querySelector('p.text-sm.text-muted-foreground:not(h3 + p)'))).toBe(
        'Closes May 19',
      );
    });

    it('links the title to the season page and a Register button to its registration card, named for the league and season', () => {
      const card = section(harness)?.querySelector(':scope > ul > li');
      const href =
        '/organizations/gulf-coast-sport-social/leagues/coed-7v7-rec/seasons/summer-2027';
      const links = [...(card?.querySelectorAll('a') ?? [])];
      expect(links.map((a) => a.getAttribute('href'))).toEqual([href, `${href}#registration`]);
      expect(text(links[1])).toBe('Register for Coed 7v7 Rec, Summer 2027');
      expect(links[1].getAttribute('data-slot')).toBe('button');
    });

    it('leaves out a season whose deadline has passed', () => {
      expect(text(section(harness))).not.toContain('Spring 2027');
    });

    it('puts Register for a season in the hero, jumping to the section', () => {
      const link = heroLink(harness);
      expect(text(link)).toBe('Register for a season');
      expect(link?.getAttribute('href')).toBe(`${ORG}#registration-open`);
      expect(link?.closest('main > :first-child')).not.toBeNull();
      expect(link?.className).toContain('h-11');
    });
  });

  describe("each league row's next season", () => {
    it('reads Registration open, Registration closed, In progress, or No upcoming season', async () => {
      const harness = await open();
      await emit(harness, queryResults(withSeasons(OPEN.slice(0, 2))));
      expect(rowStatus(harness, 1)).toEqual([
        'Registration open',
        'Summer 2027 · closes May 19',
        'Register for Coed 7v7 Rec, Summer 2027',
      ]);
      expect(rowStatus(harness, 2)).toEqual(['No upcoming season']);
      expect(rowStatus(harness, 3)).toEqual([
        'Registration open',
        'Summer 2027 · closes May 23',
        'Register for Sunday Reverse Coed 4s, Summer 2027',
      ]);
      expect(rowStatus(harness, 4)).toEqual(['In progress', 'Spring 2027']);
      expect(rowStatus(harness, 5)).toEqual(['Registration closed', 'Summer 2027']);
    });

    it('marks the badge apart from the line of text', async () => {
      const harness = await open();
      await emit(harness, queryResults(withSeasons(OPEN.slice(0, 2))));
      const badges = [...host(harness).querySelectorAll('#leagues [data-slot="badge"]')];
      expect(badges.map(text)).toEqual([
        'Registration open',
        'Registration open',
        'In progress',
        'Registration closed',
      ]);
      expect(classes(badges[0])).toEqual(classes(OPEN_BADGE));
      expect(classes(badges[2])).toEqual(classes(MUTED_BADGE));
      expect(classes(badges[3])).toEqual(classes(MUTED_BADGE));
    });

    it('leads with the season open for registration when another is in progress, and links to its registration card', async () => {
      const page = withSeasons([]);
      page.leagues[2].seasons = [
        {
          name: 'Spring 2027',
          slug: 'spring-2027',
          startDate: '2027-03-01',
          endDate: '2027-05-30',
          registrationDeadline: '2027-02-15',
        },
        SUMMER_4S,
      ];
      const harness = await open();
      await emit(harness, queryResults(page));
      expect(rowStatus(harness, 3).slice(0, 2)).toEqual([
        'Registration open',
        'Summer 2027 · closes May 23',
      ]);
      const register = host(harness).querySelector<HTMLAnchorElement>(
        '#league-3 a[href$="#registration"]',
      );
      expect(register?.getAttribute('href')).toBe(
        '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s/seasons/summer-2027#registration',
      );
      expect(text(register)).toBe('Register for Sunday Reverse Coed 4s, Summer 2027');
      expect(register?.className).toContain('pointer-coarse:min-h-11');
    });

    it('shows the open season that starts first when two share a deadline', async () => {
      const page = withSeasons([]);
      page.leagues[2].seasons = [
        { ...SUMMER_4S, name: 'Later', slug: 'a-later', startDate: '2027-07-01' },
        { ...SUMMER_4S, name: 'Earlier', slug: 'b-earlier', startDate: '2027-06-06' },
      ];
      const harness = await open();
      await emit(harness, queryResults(page));
      expect(rowStatus(harness, 3)[1]).toBe('Earlier · closes May 23');
      expect(
        host(harness).querySelector('#league-3 a[href$="#registration"]')?.getAttribute('href'),
      ).toContain('/seasons/b-earlier#');
    });

    it('has no Register link on a row whose season is not open', async () => {
      const harness = await open();
      await emit(harness, queryResults(withSeasons([])));
      expect(host(harness).querySelector('#league-4 a[href$="#registration"]')).toBeNull();
      expect(host(harness).querySelector('#league-5 a[href$="#registration"]')).toBeNull();
    });

    it('says nothing for a league row with no seasons field (a copy saved earlier)', async () => {
      const page = withSeasons([]);
      delete page.leagues[0].seasons;
      const harness = await open();
      await emit(harness, queryResults(page));
      expect(text(host(harness).querySelector('#league-1'))).not.toContain('No upcoming season');
      expect(host(harness).querySelector('#league-1 [data-slot="badge"]')).toBeNull();
    });
  });

  describe('with no open season', () => {
    it('says so, keeps the heading, and has no Register button in the hero', async () => {
      const harness = await open();
      await emit(harness, queryResults(withSeasons([])));
      expect(text(section(harness)?.querySelector('h2'))).toBe('Registration open');
      expect(text(section(harness)?.querySelector('h2')?.nextElementSibling)).toBe(
        'No season is open for registration right now. Each league below shows its next season once it is published.',
      );
      expect(section(harness)?.querySelector('ul')).toBeNull();
      expect(heroLink(harness)).toBeNull();
    });

    it('names the sport on a sport view', async () => {
      const harness = await open(`${ORG}/sports/softball`);
      await emit(harness, sportQueryResults(withSeasons([]), 'softball'));
      expect(text(section(harness)?.querySelector('h2')?.nextElementSibling)).toBe(
        'No softball season is open for registration right now. Each league below shows its next season once it is published.',
      );
      expect(heroLink(harness)).toBeNull();
    });
  });

  describe('on a sport view', () => {
    it('asks for the sport, shows only its open seasons, and jumps within the sport view', async () => {
      const harness = await open(`${ORG}/sports/soccer`);
      expect(client.activeSubscriptions.find((s) => s.name === OPEN_SEASONS)?.args).toEqual({
        orgSlug: 'gulf-coast-sport-social',
        sport: 'soccer',
      });
      await emit(harness, sportQueryResults(withSeasons(OPEN.slice(0, 2)), 'soccer'));
      expect(
        [...(section(harness)?.querySelectorAll(':scope > ul > li h3') ?? [])].map(text),
      ).toEqual(['Coed 7v7 Rec']);
      expect(heroLink(harness)?.getAttribute('href')).toBe(
        `${ORG}/sports/soccer#registration-open`,
      );
    });
  });

  describe('as the clock moves', () => {
    it('drops a card and closes the row once its deadline passes, with no new result', async () => {
      vi.setSystemTime(at('2027-05-19'));
      const harness = await open();
      await emit(harness, queryResults(withSeasons(OPEN.slice(0, 2))));
      expect(
        [...(section(harness)?.querySelectorAll(':scope > ul > li h3') ?? [])].map(text),
      ).toEqual(['Coed 7v7 Rec', 'Sunday Reverse Coed 4s']);
      expect(rowStatus(harness, 1)[0]).toBe('Registration open');

      // From 06:00 on the date at UTC-12 to the next change of date, 12:00 UTC the next day.
      vi.advanceTimersByTime(18 * HOUR);
      await settle(harness);

      expect(
        [...(section(harness)?.querySelectorAll(':scope > ul > li h3') ?? [])].map(text),
      ).toEqual(['Sunday Reverse Coed 4s']);
      expect(rowStatus(harness, 1)).toEqual(['Registration closed', 'Summer 2027']);
      expect(rowStatus(harness, 3).slice(0, 2)).toEqual([
        'Registration open',
        'Summer 2027 · closes May 23',
      ]);
    });

    it('shows the empty text and removes the hero button when the last open season closes', async () => {
      vi.setSystemTime(at('2027-05-23'));
      const harness = await open();
      await emit(harness, queryResults(withSeasons(OPEN.slice(0, 2))));
      expect(heroLink(harness)).not.toBeNull();
      vi.advanceTimersByTime(18 * HOUR);
      await settle(harness);
      expect(section(harness)?.querySelector('ul')).toBeNull();
      expect(text(section(harness)?.querySelector('h2')?.nextElementSibling)).toContain(
        'No season is open',
      );
      expect(heroLink(harness)).toBeNull();
    });
  });

  describe('while it loads', () => {
    it('shows a skeleton and its status in place of the cards, with a placeholder for the button', async () => {
      const harness = await open();
      const results = queryResults(withSeasons(OPEN.slice(0, 2)));
      for (const name of Object.keys(results).filter((key) => key !== OPEN_SEASONS)) {
        subscription(name).emit(results[name]);
      }
      await settle(harness);
      expect(text(section(harness)?.querySelector('[role="status"]'))).toBe(
        'Loading the open seasons.',
      );
      expect(section(harness)?.querySelectorAll('li')).toHaveLength(0);
      expect(heroLink(harness)).toBeNull();
      expect(text(host(harness).querySelector('#leagues h2'))).toBe('Leagues');
      subscription(OPEN_SEASONS).emit(results[OPEN_SEASONS]);
      await settle(harness);
      expect(section(harness)?.querySelector('[role="status"]')).toBeNull();
      expect(section(harness)?.querySelectorAll(':scope > ul > li')).toHaveLength(2);
    });
  });

  describe('an organization with no league', () => {
    it('has no Registration open section and no hero button', async () => {
      const empty = { ...GULF_COAST, leagueCount: 0, leagues: [], sports: [], sportCount: 0 };
      const harness = await open();
      await emit(harness, queryResults(empty));
      expect(section(harness)).toBeNull();
      expect(heroLink(harness)).toBeNull();
    });
  });
});
