import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { api } from '../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../core/data/convex';
import { OFFLINE_SAVED_QUERIES } from '../core/data/convex/offline-saved-queries';
import { savedCopyKey } from '../core/data/convex/saved-copies';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../core/data/convex/testing/saved-copy';
import { formatSavedTime } from '../offline/saved-time';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import type { PublicOrganizationPage } from './organization-path';
import { GULF_COAST, PORT_ARANSAS, queryResults } from './testing/pages';

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);
const PATH = `/organizations/${GULF_COAST.slug}`;

let client: FakeConvexClient;

const HEADER = 'organizations:getPublicPage';
const LEAGUES = 'organizations:listPublicLeagues';
const LOCATIONS = 'organizations:listPublicLocations';

const queries = (slug: string) => [
  { fn: api.organizations.getPublicPage, name: HEADER, args: { slug } },
  { fn: api.organizations.listPublicLeagues, name: LEAGUES, args: { slug, page: 1 } },
  { fn: api.organizations.listPublicLocations, name: LOCATIONS, args: { slug, page: 1 } },
];

function plant(page: PublicOrganizationPage = GULF_COAST, savedAt = SAVED_AT): void {
  const results = queryResults(page);
  for (const { fn, name, args } of queries(page.slug)) {
    plantSavedCopy(fn, args, results[name], savedAt);
  }
}

const savedEntry = (slug = GULF_COAST.slug, name = HEADER) => {
  const query = queries(slug).find((q) => q.name === name);
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
        { path: 'organizations/:orgSlug', component: OrganizationPage },
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

function subscription(name = HEADER): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

function emit(page: PublicOrganizationPage): void {
  for (const [name, value] of Object.entries(queryResults(page))) subscription(name).emit(value);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main [data-saved-copy-note]');

describe('OrganizationPage offline', () => {
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

  describe('a saved copy, opened offline (state 1)', () => {
    let harness: RouterTestingHarness;
    beforeEach(async () => {
      plant();
      stubOnLine(false);
      harness = await open(PATH, { socket: 'down' });
    });

    it('shows the name, leagues, and locations from the saved copy', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe(GULF_COAST.name);
      expect([...(main?.querySelectorAll('section h3') ?? [])].map(text)).toEqual([
        ...GULF_COAST.leagues.map((league) => league.name),
        ...GULF_COAST.locations.map((location) => location.name),
      ]);
      expect(TestBed.inject(Title).getTitle()).toBe(`${GULF_COAST.name} | Omni League`);
    });

    it('shows the saved-copy note right under the h1, with the saved time', () => {
      const expected = formatSavedTime(SAVED_AT, NOW);
      const h1 = host(harness).querySelector('main h1');
      const shown = note(harness);
      expect(h1?.nextElementSibling?.tagName).toBe('APP-SAVED-COPY-NOTE');
      expect(h1?.nextElementSibling?.firstElementChild).toBe(shown);
      expect(text(shown)).toBe(`Saved copy from ${expected.text}. It may have changed since.`);
      expect(shown?.querySelector('time')?.getAttribute('datetime')).toBe(expected.datetime);
    });

    it('keeps every link enabled', () => {
      const links = [...host(harness).querySelectorAll('a')];
      expect(links.length).toBeGreaterThan(1);
      for (const link of links) {
        expect(link.hasAttribute('aria-disabled'), link.getAttribute('href') ?? '').toBe(false);
        expect(link.hasAttribute('disabled')).toBe(false);
      }
    });

    it('is replaced by the live result when the connection returns, and the note goes', async () => {
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      emit({ ...GULF_COAST, name: 'Gulf Coast Live' });
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Live');
      expect(note(harness)).toBeNull();
      expect(JSON.parse(savedEntry() ?? 'null')).toMatchObject({
        v: { name: 'Gulf Coast Live' },
        savedAt: NOW,
      });
      for (const name of [LEAGUES, LOCATIONS]) {
        expect(JSON.parse(savedEntry(GULF_COAST.slug, name) ?? 'null'), name).toMatchObject({
          savedAt: NOW,
        });
      }
    });

    it('shows page 1 of the leagues and locations lists and the totals from their saved copies', () => {
      const tiles = [...host(harness).querySelectorAll('main dl > div dd')].map(text);
      expect(tiles).toEqual(['5', '3', '3']);
    });
  });

  it('dates the note by the oldest saved copy on screen', async () => {
    const older = SAVED_AT - 3 * 60 * 60 * 1000;
    plant();
    plantSavedCopy(
      api.organizations.listPublicLeagues,
      { slug: GULF_COAST.slug, page: 1 },
      queryResults(GULF_COAST)[LEAGUES],
      older,
    );
    stubOnLine(false);
    const harness = await open(PATH, { socket: 'down' });
    expect(text(note(harness))).toContain(formatSavedTime(older, NOW).text);
  });

  it('online before the first live result: shows the saved copy with no note (state 4)', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
    expect(note(harness)).toBeNull();
  });

  it('field wifi: the saved copy shows unmarked for 5 s, then the note appears (state 3)', async () => {
    plant();
    stubOnLine(true);
    const harness = await open(PATH, { socket: 'down' });
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
    expect(note(harness)).toBeNull();
    vi.advanceTimersByTime(4_999);
    await settle(harness);
    expect(note(harness)).toBeNull();
    vi.advanceTimersByTime(1);
    await settle(harness);
    expect(note(harness)).not.toBeNull();
  });

  describe('no saved copy (state 2)', () => {
    it('offline: shows the not-saved view at once, top bar only, with Try again to the path', async () => {
      plant(PORT_ARANSAS);
      stubOnLine(false);
      const harness = await open(`${PATH}?ott=SECRET#league-2`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe(PATH);
      expect(host(harness).querySelector('app-public-layout')).not.toBeNull();
      expect(host(harness).querySelector('nav:not([aria-label="Footer"])')).toBeNull();
      expect(host(harness).querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
      for (const link of host(harness).querySelectorAll('a')) {
        expect(link.hasAttribute('aria-disabled')).toBe(false);
      }
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      emit(GULF_COAST);
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
      expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
      expect(note(harness)).toBeNull();
    });

    it.each<[string, unknown, Record<string, unknown>]>([
      ['an object missing fields', { name: 'Shape Only' }, {}],
      ['a number', 42, {}],
      ['a string', 'x', {}],
      ['an array', [1, 2], {}],
      ['another version', GULF_COAST, { version: OFFLINE_SAVED_QUERIES[0].version + 1 }],
      ['a time in the future', GULF_COAST, { savedAt: NOW + 24 * 60 * 60 * 1000 }],
    ])(
      'offline with a saved value that is not usable (%s): shows the not-saved view and removes it',
      async (_, value, stored) => {
        plantSavedCopy(
          api.organizations.getPublicPage,
          { slug: GULF_COAST.slug },
          value,
          SAVED_AT,
          stored,
        );
        stubOnLine(false);
        const errors = vi.spyOn(console, 'error');
        const harness = await open(PATH, { socket: 'down' });
        expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
        expect(text(host(harness).querySelector('main h1'))).toBe(
          "This page isn't saved on this device",
        );
        expect(note(harness)).toBeNull();
        expect(savedEntry()).toBeNull();
        expect(errors).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['the header', HEADER],
      ['the leagues list', LEAGUES],
      ['the locations list', LOCATIONS],
    ])('offline with %s not saved: shows the not-saved view', async (_, missing) => {
      plant();
      const missingQuery = queries(GULF_COAST.slug).find((q) => q.name === missing);
      localStorage.removeItem(savedCopyKey(missingQuery!.fn, missingQuery!.args));
      stubOnLine(false);
      const harness = await open(PATH, { socket: 'down' });
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(host(harness).querySelector('main h1')?.textContent).toContain("isn't saved");
      expect(note(harness)).toBeNull();
    });

    it.each([
      [LEAGUES, { rows: 'none', page: 1, pageCount: 1, total: 1 }],
      [LEAGUES, { rows: [{ name: 'Coed' }], page: 1, pageCount: 1, total: 1 }],
      [LOCATIONS, { rows: [], page: 1 }],
      [LOCATIONS, null],
    ])(
      'offline with an unusable saved list (%s): shows the not-saved view and removes it',
      async (name, value) => {
        plant();
        const query = queries(GULF_COAST.slug).find((q) => q.name === name)!;
        plantSavedCopy(query.fn, query.args, value, SAVED_AT);
        stubOnLine(false);
        const errors = vi.spyOn(console, 'error');
        const harness = await open(PATH, { socket: 'down' });
        expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
        expect(savedEntry(GULF_COAST.slug, name)).toBeNull();
        expect(errors).not.toHaveBeenCalled();
      },
    );

    it('field wifi: keeps the loading view for 5 s, then shows the not-saved view', async () => {
      stubOnLine(true);
      const harness = await open(PATH, { socket: 'down' });
      expect(host(harness).querySelector('main h1')).toBeNull();
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
      vi.advanceTimersByTime(5_000);
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    });

    it('online and connected: keeps the loading view', async () => {
      stubOnLine(true);
      const harness = await open();
      vi.advanceTimersByTime(10_000);
      await settle(harness);
      expect(host(harness).querySelector('main h1')).toBeNull();
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
    });
  });

  it('a live null removes the saved entry and shows the not-found view with no note (state 5)', async () => {
    plant();
    stubOnLine(true);
    const harness = await open();
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
    subscription().emit(null);
    await settle(harness);
    expect(savedEntry()).toBeNull();
    expect(host(harness).querySelector('app-not-found-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Page not found');
    expect(note(harness)).toBeNull();
    expect(host(harness).querySelector('nav:not([aria-label="Footer"])')).toBeNull();
  });

  it('renders live data with no error when localStorage throws on read and on write', async () => {
    for (const method of ['getItem', 'setItem', 'removeItem', 'key'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    }
    stubOnLine(true);
    const harness = await open();
    emit(GULF_COAST);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
    expect(host(harness).querySelector('app-server-error-view')).toBeNull();
  });
});
