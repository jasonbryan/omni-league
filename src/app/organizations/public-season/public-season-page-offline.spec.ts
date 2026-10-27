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
import { PublicSeasonPage } from './public-season-page';
import { seasonQueryResults, SUMMER_2027, without } from './testing/season-data';

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);
const ORG_SLUG = 'gulf-coast-sport-social';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const PATH = `/organizations/${ORG_SLUG}/leagues/${LEAGUE_SLUG}/seasons/summer-2027`;

let client: FakeConvexClient;

const SEASON = 'seasons:getPublicPage';

const queries = [
  {
    fn: api.seasons.getPublicPage,
    name: SEASON,
    args: { orgSlug: ORG_SLUG, leagueSlug: LEAGUE_SLUG, seasonSlug: 'summer-2027' },
  },
];

function plant(results = seasonQueryResults(), savedAt = SAVED_AT): void {
  for (const { fn, name, args } of queries) plantSavedCopy(fn, args, results[name], savedAt);
}

const savedEntry = (name = SEASON) => {
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

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main [data-saved-copy-note]');

describe('PublicSeasonPage offline', () => {
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

  it('lists the page’s own query with its returns validator', () => {
    const listed = new Set(OFFLINE_SAVED_QUERIES.map((entry) => getFunctionName(entry.query)));
    for (const { name } of queries) expect(listed.has(name), name).toBe(true);
  });

  describe('a saved copy, opened offline', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      plant();
      stubOnLine(false);
      harness = await open(PATH, { socket: 'down' });
    });

    it('shows the season, its details, from the saved copies', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('Sunday Reverse Coed 4s · Summer 2027');
      expect(text(main?.querySelector('dl'))).toContain('Jun 6 – Aug 29, 2027');
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Sunday Reverse Coed 4s · Summer 2027 | Gulf Coast Sport & Social | Omni League',
      );
    });

    it('shows the saved-copy note right under the h1, with the saved time', () => {
      const expected = formatSavedTime(SAVED_AT, NOW);
      const h1 = host(harness).querySelector('main h1');
      const shown = note(harness);
      expect(h1?.nextElementSibling?.tagName).toBe('APP-SAVED-COPY-NOTE');
      expect(h1?.nextElementSibling?.firstElementChild).toBe(shown);
      expect(text(shown)).toBe(`Saved copy from ${expected.text}. It may have changed since.`);
    });

    it('is replaced by the live result when the connection returns, and the note goes', async () => {
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      for (const [name, value] of Object.entries(
        seasonQueryResults({ season: { ...SUMMER_2027, name: 'Summer Live' } }),
      )) {
        subscription(name).emit(value);
      }
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe(
        'Sunday Reverse Coed 4s · Summer Live',
      );
      expect(note(harness)).toBeNull();
      expect(JSON.parse(savedEntry() ?? 'null')).toMatchObject({
        v: { name: 'Summer Live' },
        savedAt: NOW,
      });
    });
  });

  it('online before the first live result: shows the saved copy with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'Sunday Reverse Coed 4s · Summer 2027',
    );
    expect(note(harness)).toBeNull();
  });

  it('offline: opens a copy saved before the deadline, addresses, division, and upcoming seasons existed', async () => {
    const { league, ...rest } = SUMMER_2027;
    const earlierCopy = {
      ...without(rest, 'registrationDeadline'),
      league: {
        name: league.name,
        slug: league.slug,
        sportName: league.sportName,
        locationNames: league.locationNames,
      },
    };
    plant(seasonQueryResults({ season: earlierCopy }));
    stubOnLine(false);
    const harness = await open(PATH, { socket: 'down' });
    const main = host(harness).querySelector('main');
    expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    expect(text(main?.querySelector('h1'))).toBe('Sunday Reverse Coed 4s · Summer 2027');
    expect(main?.querySelector('#registration')).toBeNull();
    expect(text(main?.querySelector('dl'))).toContain('North Beach Sand Courts');
    expect(note(harness)).not.toBeNull();
  });

  describe('no saved copy', () => {
    it('offline: shows the not-saved view at once, top bar only, with Try again to the season page asked for', async () => {
      plant();
      stubOnLine(false);
      const other = `${PATH.replace('summer-2027', 'fall-2026')}`;
      const harness = await open(`${other}?ott=SECRET#details`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe(other);
      expect(host(harness).querySelector('main nav')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
    });

    it('offline with the season not saved: shows the not-saved view', async () => {
      plant();
      const query = queries.find((q) => q.name === SEASON)!;
      localStorage.removeItem(savedCopyKey(query.fn, query.args));
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(note(harness)).toBeNull();
    });

    it.each([
      [SEASON, { name: 'Shape Only' }],
      [SEASON, { ...SUMMER_2027, minimumRosterSize: '4' }],
      [SEASON, 42],
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

  it('a live null removes the saved season and shows the not-found view with no note', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe(
      'Sunday Reverse Coed 4s · Summer 2027',
    );
    subscription(SEASON).emit(null);
    await settle(harness);
    expect(savedEntry(SEASON)).toBeNull();
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(note(harness)).toBeNull();
  });
});
