import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { convexToJson } from 'convex/values';
import { api } from '../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../core/data/convex';
import { savedCopyKey } from '../core/data/convex/saved-copies';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { formatSavedTime } from '../offline/saved-time';
import { PlainTestPage } from '../shell/testing/test-pages';
import { OrganizationPage } from './organization-page';
import { GULF_COAST, PORT_ARANSAS } from './testing/pages';

// #82: saved copies on the organization page, the not-saved view, and the removed organization
// (design/mockups/82-offline-pages.html states 1 to 5). "Offline" is the adapter's `online` signal
// (#88): false at once with navigator.onLine false, and 5 s after start when the socket never
// connects (field wifi with no internet).

const NOW = Date.UTC(2026, 9, 10, 14, 30);
const SAVED_AT = Date.UTC(2026, 9, 10, 2, 14);
const PATH = `/organizations/${GULF_COAST.slug}`;

let client: FakeConvexClient;

function plant(page = GULF_COAST, savedAt = SAVED_AT): void {
  localStorage.setItem(
    savedCopyKey(api.organizations.getPublicPage, { slug: page.slug }),
    JSON.stringify({ v: convexToJson(page), savedAt, usedAt: savedAt }),
  );
}

const savedEntry = (slug = GULF_COAST.slug) =>
  localStorage.getItem(savedCopyKey(api.organizations.getPublicPage, { slug }));

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

/**
 * Opens `url` with a fake client. `socket: 'down'` models a client that has not connected yet
 * (field wifi, or a device offline); the default is connected.
 */
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

function subscription(): FakeSubscription {
  const active = client.activeSubscriptions;
  expect(active).toHaveLength(1);
  return active[0];
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const note = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main [data-saved-copy-note]');

describe('OrganizationPage offline (#82)', () => {
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

    it('shows the name, leagues, locations, and sidebar from the saved copy', () => {
      const main = host(harness).querySelector('main');
      expect(text(main?.querySelector('h1'))).toBe(GULF_COAST.name);
      expect([...(main?.querySelectorAll('section h3') ?? [])].map(text)).toEqual([
        ...GULF_COAST.leagues.map((league) => league.name),
        ...GULF_COAST.locations.map((location) => location.name),
      ]);
      expect(host(harness).querySelector(`nav[aria-label="${GULF_COAST.name}"]`)).not.toBeNull();
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
      subscription().emit({ ...GULF_COAST, name: 'Gulf Coast Live' });
      await settle(harness);
      expect(text(host(harness).querySelector('main h1'))).toBe('Gulf Coast Live');
      expect(note(harness)).toBeNull();
      expect(JSON.parse(savedEntry() ?? 'null')).toMatchObject({
        v: { name: 'Gulf Coast Live' },
        savedAt: NOW,
      });
    });
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
      plant(PORT_ARANSAS); // another page is saved; this one is not
      stubOnLine(false);
      const harness = await open(`${PATH}?ott=SECRET#league-2`, { socket: 'down' });
      const main = host(harness).querySelector('main');
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(text(main?.querySelector('h1'))).toBe("This page isn't saved on this device");
      const retry = main?.querySelector('a');
      expect(text(retry)).toBe('Try again');
      expect(retry?.getAttribute('href')).toBe(PATH);
      expect(host(harness).querySelector('nav')).toBeNull();
      expect(host(harness).querySelector('button')).toBeNull();
      expect(TestBed.inject(Title).getTitle()).toBe('Not saved on this device | Omni League');
      for (const link of host(harness).querySelectorAll('a')) {
        expect(link.hasAttribute('aria-disabled')).toBe(false);
      }
      // The subscription stays open: the page appears by itself once a result arrives.
      stubOnLine(true);
      window.dispatchEvent(new Event('online'));
      client.setConnected(true);
      subscription().emit(GULF_COAST);
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).toBeNull();
      expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
      expect(note(harness)).toBeNull();
    });

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

  it("a live null removes the saved entry and shows #23's not-found view with no note (state 5)", async () => {
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
    expect(host(harness).querySelector('nav')).toBeNull();
  });

  it('renders live data with no error when localStorage throws on read and on write', async () => {
    for (const method of ['getItem', 'setItem', 'removeItem', 'key'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
    }
    stubOnLine(true);
    const harness = await open();
    subscription().emit(GULF_COAST);
    await settle(harness);
    expect(text(host(harness).querySelector('main h1'))).toBe(GULF_COAST.name);
    expect(host(harness).querySelector('app-server-error-view')).toBeNull();
  });
});
