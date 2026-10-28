import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { getFunctionName } from 'convex/server';
import { api } from '../../../convex/_generated/api';
import { CONVEX_CLIENT } from '../core/data/convex';
import { OFFLINE_SAVED_QUERIES } from '../core/data/convex/offline-saved-queries';
import { FakeConvexClient } from '../core/data/convex/testing/fake-convex-client';
import { plantSavedCopy } from '../core/data/convex/testing/saved-copy';
import { formatSavedTime } from '../offline/saved-time';
import { PlainTestPage } from '../shell/testing/test-pages';
import { FindPage } from './find-page';
import { at, COED_RESULTS, OPEN_DAY } from './testing/find-data';
import { ORGANIZATIONS } from './testing/organizations-data';

const NOW = at(OPEN_DAY);
const SAVED_AT = NOW - 3 * 60 * 60 * 1000;

let client: FakeConvexClient;

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

async function open(url: string, socket: 'up' | 'down' = 'down'): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  if (socket === 'down') client.setConnected(false, { neverConnected: true });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'leagues', component: FindPage },
        { path: '**', component: PlainTestPage },
      ]),
      { provide: CONVEX_CLIENT, useValue: client },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
  }
  return harness;
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

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

describe('FindPage offline', () => {
  it('lists the search among the saved queries, with its own returns validator', () => {
    const entry = OFFLINE_SAVED_QUERIES.find(
      (listed) => getFunctionName(listed.query) === 'search:leagues',
    );
    expect(entry).toBeDefined();
  });

  it('opens a search viewed online from its saved copy, with the saved-copy note under the intro', async () => {
    plantSavedCopy(api.search.leagues, { q: 'coed' }, COED_RESULTS, SAVED_AT);
    stubOnLine(false);
    const harness = await open('/leagues?q=coed');
    const main = host(harness).querySelector('main')!;
    expect([...main.querySelectorAll('section ul > li h3')].map(text)).toEqual([
      'Sunday Reverse Coed 4s',
      'Thursday Night Coed 2s',
      'Saturday Coed 6s',
    ]);
    expect(text(main.querySelector('[data-saved-copy-note]'))).toBe(
      `Saved copy from ${formatSavedTime(SAVED_AT, NOW).text}. It may have changed since.`,
    );
    expect(main.querySelector('app-not-saved-view')).toBeNull();
  });

  it('shows the not-saved view for a search that was not viewed', async () => {
    plantSavedCopy(api.search.leagues, { q: 'coed' }, COED_RESULTS, SAVED_AT);
    stubOnLine(false);
    const harness = await open('/leagues?q=soccer');
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe(
      "This page isn't saved on this device",
    );
    expect(host(harness).querySelector('main a')?.getAttribute('href')).toBe('/leagues?q=soccer');
    expect(host(harness).querySelector('main form')).toBeNull();
  });

  it('opens a saved no-results search with its saved suggestions, and a suggestion that was not viewed shows the not-saved view', async () => {
    plantSavedCopy(
      api.search.leagues,
      { q: 'coed 4s austin' },
      { rows: [], more: false, suggestions: ['coed 4s'] },
      SAVED_AT,
    );
    stubOnLine(false);
    const harness = await open('/leagues?q=coed%204s%20austin');
    const main = host(harness).querySelector('main')!;
    expect(text(main)).toContain('Try fewer words:');
    const link = main.querySelector<HTMLAnchorElement>('ul a')!;
    expect(link.getAttribute('href')).toBe('/leagues?q=coed%204s');
    link.click();
    for (let i = 0; i < 3; i++) {
      TestBed.tick();
      await harness.fixture.whenStable();
    }
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
  });

  it('lists the organizations browse query among the saved queries', () => {
    expect(
      OFFLINE_SAVED_QUERIES.some(
        (listed) => getFunctionName(listed.query) === 'search:organizations',
      ),
    ).toBe(true);
  });

  it('opens the organizations viewed online from their saved copy, with the saved-copy note under the intro', async () => {
    plantSavedCopy(api.search.organizations, { page: 1 }, ORGANIZATIONS, SAVED_AT);
    stubOnLine(false);
    const harness = await open('/leagues');
    const main = host(harness).querySelector('main')!;
    expect(main.querySelector('form[role="search"]')).not.toBeNull();
    expect([...main.querySelectorAll('section ul > li h3')].map(text)).toEqual([
      'Front Range Rec Sports',
      'Gulf Coast Sport & Social',
      'Saguaro Valley Softball',
    ]);
    expect(text(main.querySelector('[data-saved-copy-note]'))).toBe(
      `Saved copy from ${formatSavedTime(SAVED_AT, NOW).text}. It may have changed since.`,
    );
    expect(main.querySelector('app-not-saved-view')).toBeNull();
  });

  it('shows the not-saved view for a page of organizations that was not viewed', async () => {
    plantSavedCopy(api.search.organizations, { page: 1 }, ORGANIZATIONS, SAVED_AT);
    stubOnLine(false);
    const harness = await open('/leagues?page=2');
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
    expect(host(harness).querySelector('[data-saved-copy-note]')).toBeNull();
  });

  it('shows the not-saved view for the organizations when nothing was saved', async () => {
    stubOnLine(false);
    const harness = await open('/leagues');
    expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
  });

  it('online before the first live result shows the saved copy with no note', async () => {
    plantSavedCopy(api.search.leagues, { q: 'coed' }, COED_RESULTS, SAVED_AT);
    stubOnLine(true);
    const harness = await open('/leagues?q=coed', 'up');
    expect(host(harness).querySelectorAll('main section ul > li')).toHaveLength(3);
    expect(host(harness).querySelector('[data-saved-copy-note]')).toBeNull();
  });
});
