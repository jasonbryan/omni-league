import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { getFunctionName } from 'convex/server';
import { api } from '../../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../../core/data/convex';
import { OFFLINE_SAVED_QUERIES } from '../../core/data/convex/offline-saved-queries';
import { savedCopyKey } from '../../core/data/convex/saved-copies';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../../core/data/convex/testing/saved-copy';
import { formatSavedTime } from '../../offline/saved-time';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicLeaguePage } from './public-league-page';
import type { PublicLeagueSeasons } from './public-league-path';
import { leagueQueryResults, NO_SEASONS, SUNDAY_4S, without } from './testing/league-data';

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);
const ORG_SLUG = 'gulf-coast-sport-social';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const PATH = `/organizations/${ORG_SLUG}/leagues/${LEAGUE_SLUG}`;

let client: FakeConvexClient;

const ORG = 'organizations:getPublicPage';
const LEAGUE = 'leagues:getPublicPage';
const SEASONS = 'seasons:listPublic';

const queries = [
  { fn: api.organizations.getPublicPage, name: ORG, args: { slug: ORG_SLUG } },
  {
    fn: api.leagues.getPublicPage,
    name: LEAGUE,
    args: { orgSlug: ORG_SLUG, leagueSlug: LEAGUE_SLUG },
  },
  {
    fn: api.seasons.listPublic,
    name: SEASONS,
    args: { orgSlug: ORG_SLUG, leagueSlug: LEAGUE_SLUG, page: 1 },
  },
];

function plant(results = leagueQueryResults(), savedAt = SAVED_AT): void {
  for (const { fn, name, args } of queries) plantSavedCopy(fn, args, results[name], savedAt);
}

const savedEntry = (name = LEAGUE) => {
  const query = queries.find((q) => q.name === name);
  return query ? localStorage.getItem(savedCopyKey(query.fn, query.args)) : null;
};

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

async function open(
  url = PATH,
  options: { socket?: 'up' | 'down' } = {},
): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  if (options.socket === 'down') client.setConnected(false, { neverConnected: true });
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

function emit(results = leagueQueryResults()): void {
  for (const [name, value] of Object.entries(results)) subscription(name).emit(value);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main [data-saved-copy-note]');

describe('PublicLeaguePage offline', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('lists the page’s own two queries beside the organization header, each with its own returns validator', () => {
    const listed = new Set(OFFLINE_SAVED_QUERIES.map((entry) => getFunctionName(entry.query)));
    for (const { name } of queries) expect(listed.has(name), name).toBe(true);
  });

  describe('a saved copy, opened offline (state 8)', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      plant();
      stubOnLine(false);
      harness = await open(PATH, { socket: 'down' });
    });

    it('shows the league, its seasons, from the saved copies', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe(SUNDAY_4S.name);
      expect([...(main?.querySelectorAll('section#seasons > ul > li h3') ?? [])].map(text)).toEqual(
        ['Summer 2027', 'Spring 2027', 'Fall 2026', 'Summer 2026', 'Spring 2026'],
      );
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Sunday Reverse Coed 4s | Gulf Coast Sport & Social | Omni League',
      );
    });

    it('shows the saved-copy note under the heading block, with the saved time', () => {
      const expected = formatSavedTime(SAVED_AT, NOW);
      const h1 = host(harness).querySelector('main h1');
      const shown = note(harness);
      const wrapper = shown?.parentElement;
      expect(wrapper?.tagName).toBe('APP-SAVED-COPY-NOTE');
      expect(wrapper?.parentElement).toBe(h1?.parentElement);
      expect(wrapper?.previousElementSibling?.tagName).toBe('P');
      expect(h1!.compareDocumentPosition(wrapper!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(text(shown)).toBe(`Saved copy from ${expected.text}. It may have changed since.`);
    });

    it('keeps every link enabled', () => {
      const links = [...host(harness).querySelectorAll('a')];
      expect(links.length).toBeGreaterThan(1);
      for (const link of links) {
        expect(link.hasAttribute('aria-disabled'), link.getAttribute('href') ?? '').toBe(false);
      }
    });

    it('is replaced by the live result when the connection returns, and the note goes', async () => {
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      emit(leagueQueryResults({ league: { ...SUNDAY_4S, name: 'Sunday Live' } }));
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Sunday Live');
      expect(note(harness)).toBeNull();
      expect(JSON.parse(savedEntry() ?? 'null')).toMatchObject({
        v: { name: 'Sunday Live' },
        savedAt: NOW,
      });
      expect(JSON.parse(savedEntry(SEASONS) ?? 'null')).toMatchObject({ savedAt: NOW });
    });
  });

  it('shows copies saved before the page held the division, addresses, seasons, and deadlines, without a card or statuses', async () => {
    const league = without(SUNDAY_4S, 'divisionLabel', 'locations', 'seasons');
    const rows = leagueQueryResults()[SEASONS] as PublicLeagueSeasons;
    const earlier = {
      ...rows,
      rows: rows.rows.map((row) => without(row, 'registrationDeadline')),
    };
    plant({ ...leagueQueryResults(), [LEAGUE]: league, [SEASONS]: earlier });
    stubOnLine(false);
    const harness = await open(PATH, { socket: 'down' });
    const main = host(harness).querySelector('main');
    expect(text(main?.querySelector('h1'))).toBe(SUNDAY_4S.name);
    expect(main?.querySelector('section#registration-open')).toBeNull();
    expect(main?.querySelector('section#seasons [data-slot="badge"]')).toBeNull();
    expect(main?.querySelectorAll('section#seasons > ul > li')).toHaveLength(5);
    expect(note(harness)).not.toBeNull();
  });

  it('dates the note by the oldest saved copy on screen', async () => {
    const older = SAVED_AT - 3 * 60 * 60 * 1000;
    plant();
    plantSavedCopy(
      api.seasons.listPublic,
      { orgSlug: ORG_SLUG, leagueSlug: LEAGUE_SLUG, page: 1 },
      leagueQueryResults()[SEASONS],
      older,
    );
    stubOnLine(false);
    const harness = await open(PATH, { socket: 'down' });
    expect(text(note(harness))).toContain(formatSavedTime(older, NOW).text);
  });

  it('online before the first live result: shows the saved copy with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe(SUNDAY_4S.name);
    expect(note(harness)).toBeNull();
  });

  describe('a page link while offline', () => {
    const nextLink = (harness: RouterTestingHarness) =>
      host(harness).querySelector<HTMLAnchorElement>(
        'nav[aria-label="Seasons pages"] a[href$="?page=2#seasons"]',
      )!;

    it('to a page with no saved copy shows the not-saved view, never the previous rows, and nothing stays busy', async () => {
      plant();
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      expect(host(harness).querySelector('section#seasons > ul')).not.toBeNull();
      nextLink(harness).click();
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(host(harness).querySelector('section#seasons')).toBeNull();
      expect(host(harness).querySelector('[aria-busy="true"]')).toBeNull();
      expect(host(harness).querySelector('nav[aria-label="Seasons pages"]')).toBeNull();
      const retry = host(harness).querySelector('main a');
      expect(retry?.getAttribute('href')).toBe(`${PATH}?page=2`);
    });

    it('to a page with its own saved copy opens it with the note', async () => {
      plant();
      plantSavedCopy(
        api.seasons.listPublic,
        { orgSlug: ORG_SLUG, leagueSlug: LEAGUE_SLUG, page: 2 },
        leagueQueryResults({ page: 2 })[SEASONS],
        SAVED_AT,
      );
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      nextLink(harness).click();
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
      expect([...host(harness).querySelectorAll('section#seasons > ul > li h3')].map(text)).toEqual(
        ['Fall 2025', 'Summer 2025'],
      );
      expect(note(harness)).not.toBeNull();
    });

    it('online, the previous rows stay with aria-busy until the page arrives; going offline then shows the not-saved view', async () => {
      stubOnLine(true);
      const harness = await open();
      emit();
      await settle(harness);
      nextLink(harness).click();
      await settle(harness);
      expect(host(harness).querySelector('section#seasons > ul')?.getAttribute('aria-busy')).toBe(
        'true',
      );
      stubOnLine(false);
      window.dispatchEvent(new Event('offline'));
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(host(harness).querySelector('[aria-busy="true"]')).toBeNull();
    });
  });

  it('a saved empty list shows the empty state with the note', async () => {
    plant(leagueQueryResults({ seasons: NO_SEASONS }));
    stubOnLine(false);
    const harness = await open(PATH, { socket: 'down' });
    expect(text(host(harness).querySelector('main section#seasons'))).toContain('No seasons yet');
    expect(note(harness)).not.toBeNull();
  });

  describe('no saved copy (state 7)', () => {
    it('offline: shows the not-saved view at once, top bar only, with Try again to the page asked for', async () => {
      plant(leagueQueryResults({ league: { ...SUNDAY_4S, slug: 'another-league' } }));
      stubOnLine(false);
      const harness = await open(`${PATH}?page=2&ott=SECRET#seasons`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe(`${PATH}?page=2`);
      expect(host(harness).querySelector('main nav')).toBeNull();
      expect(host(harness).querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
    });

    it.each([
      ['the organization', ORG],
      ['the league', LEAGUE],
      ['the seasons', SEASONS],
    ])('offline with %s not saved: shows the not-saved view', async (_, missing) => {
      plant();
      const query = queries.find((q) => q.name === missing)!;
      localStorage.removeItem(savedCopyKey(query.fn, query.args));
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(note(harness)).toBeNull();
    });

    it.each([
      [SEASONS, { rows: 'none', page: 1, pageCount: 1, total: 1 }],
      [SEASONS, { rows: [{ name: 'Summer 2027' }], page: 1, pageCount: 1, total: 1 }],
      [LEAGUE, { name: 'Shape Only' }],
      [LEAGUE, 42],
    ])(
      'offline with an unusable saved copy (%s): shows the not-saved view and removes it',
      async (name, value) => {
        plant();
        const query = queries.find((q) => q.name === name)!;
        plantSavedCopy(query.fn, query.args, value, SAVED_AT);
        stubOnLine(false);
        const errors = vi.spyOn(console, 'error');
        const harness = await open(PATH, { socket: 'down' });
        expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
        expect(savedEntry(name)).toBeNull();
        expect(errors).not.toHaveBeenCalled();
      },
    );

    it('online and connected: keeps the loading view', async () => {
      stubOnLine(true);
      const harness = await open();
      vi.advanceTimersByTime(10_000);
      await settle(harness);
      expect(host(harness).querySelector('main h1')).toBeNull();
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    });
  });

  it('a live null removes the saved league and shows the not-found view with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe(SUNDAY_4S.name);
    subscription(LEAGUE).emit(null);
    await settle(harness);
    expect(savedEntry(LEAGUE)).toBeNull();
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(note(harness)).toBeNull();
  });
});
