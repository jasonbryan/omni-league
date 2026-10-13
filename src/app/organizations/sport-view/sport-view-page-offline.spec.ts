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
import { SportViewPage } from './sport-view-page';
import { CONFLUENCE, leaguesPage, sportQueryResults } from './testing/sport-data';

// #114: saved copies on the sport view (design/mockups/82-offline-pages.html). Both of its queries
// are on the saved-copy allow-list; a saved `listPublicLeagues` copy is keyed by its whole args, so
// each sport and each page of it is its own copy. "Offline" is the adapter's `online` signal (#88).

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);
const ORG_SLUG = 'confluence-sport-social';
const PATH = `/organizations/${ORG_SLUG}/sports/beach-volleyball`;

let client: FakeConvexClient;

const ORG = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';

/** The saved-copy allow-list entries' functions and the args the page asks them with (page 1). */
const queries = [
  { fn: api.organizations.getPublicPage, name: ORG, args: { slug: ORG_SLUG } },
  {
    fn: api.organizations.listPublicLeagues,
    name: LEAGUES,
    args: { slug: ORG_SLUG, page: 1, sport: 'beachVolleyball' as const },
  },
];

/** Saves the two results the page's queries return for page 1. */
function plant(results = sportQueryResults(), savedAt = SAVED_AT): void {
  for (const { fn, name, args } of queries) plantSavedCopy(fn, args, results[name], savedAt);
}

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

/** Opens `url` with a fake client; `socket: 'down'` models a client that has not connected yet. */
async function open(
  url = PATH,
  options: { socket?: 'up' | 'down' } = {},
): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  if (options.socket === 'down') client.setConnected(false, { neverConnected: true });
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
const nextLink = (harness: RouterTestingHarness) =>
  host(harness).querySelector<HTMLAnchorElement>(
    'nav[aria-label="Leagues pages"] a[href$="?page=2#leagues"]',
  )!;

describe('SportViewPage offline', () => {
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

  it('lists the page’s two queries on the saved-copy allow-list', () => {
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

    it('shows the sport, its leagues, and the sidebar from the saved copies', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe('Beach volleyball');
      expect([...(main?.querySelectorAll('section#leagues > ul > li h3') ?? [])]).toHaveLength(5);
      expect(
        host(harness).querySelector('nav[aria-label="Confluence Sport & Social"]'),
      ).not.toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe(
        'Beach volleyball | Confluence Sport & Social | Omni League',
      );
    });

    it('shows the saved-copy note right under the h1, with the saved time', () => {
      const expected = formatSavedTime(SAVED_AT, NOW);
      const h1 = host(harness).querySelector('main h1');
      expect(h1?.nextElementSibling?.tagName).toBe('APP-SAVED-COPY-NOTE');
      expect(text(note(harness))).toBe(
        `Saved copy from ${expected.text}. It may have changed since.`,
      );
    });

    it('is replaced by the live result when the connection returns, and the note goes', async () => {
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      subscription(ORG).emit(CONFLUENCE);
      subscription(LEAGUES).emit(leaguesPage(1, 11));
      await settle(harness);
      expect(note(harness)).toBeNull();
      expect(text(host(harness).querySelector('main h1 + p'))).toBe('12 leagues at 3 locations');
      expect(text(host(harness).querySelector('nav[aria-label="Leagues pages"] p'))).toBe(
        '1–5 of 11 leagues',
      );
    });
  });

  it('keeps each sport’s saved copy apart: another sport’s view is not saved', async () => {
    plant();
    stubOnLine(false);
    const harness = await open(`/organizations/${ORG_SLUG}/sports/soccer`, { socket: 'down' });
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(host(harness).querySelector('main h1')?.textContent).not.toContain('Soccer');
  });

  describe('a page link while offline', () => {
    it('to a page with no saved copy shows the not-saved view, never the previous rows, and nothing stays busy', async () => {
      plant();
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      nextLink(harness).click();
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(host(harness).querySelector('section#leagues')).toBeNull();
      expect(host(harness).querySelector('[aria-busy="true"]')).toBeNull();
      expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe(`${PATH}?page=2`);
    });

    it('to a page with its own saved copy opens it with the note', async () => {
      plant();
      plantSavedCopy(
        api.organizations.listPublicLeagues,
        { slug: ORG_SLUG, page: 2, sport: 'beachVolleyball' },
        leaguesPage(2),
        SAVED_AT,
      );
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      nextLink(harness).click();
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
      expect([...host(harness).querySelectorAll('section#leagues > ul > li h3')].map(text)[0]).toBe(
        'Saturday Open 2s',
      );
      expect(note(harness)).not.toBeNull();
    });
  });

  describe('no saved copy', () => {
    it('offline: shows the not-saved view at once, top bar only, with Try again to the page asked for', async () => {
      stubOnLine(false);
      const harness = await open(`${PATH}?page=2&ott=SECRET#leagues`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      expect(main?.querySelector('a')?.getAttribute('href')).toBe(`${PATH}?page=2`);
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
    });

    it.each([
      ['the organization', ORG],
      ['the leagues', LEAGUES],
    ])('offline with %s not saved: shows the not-saved view', async (_, missing) => {
      plant();
      const query = queries.find((q) => q.name === missing)!;
      localStorage.removeItem(savedCopyKey(query.fn, query.args));
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(note(harness)).toBeNull();
    });

    it('an unknown sport segment is not-found, not "not saved", offline too', async () => {
      stubOnLine(false);
      const harness = await open(`/organizations/${ORG_SLUG}/sports/curling`, { socket: 'down' });
      expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    });
  });
});
