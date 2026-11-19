import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../core/data/convex/testing/fake-convex-client';
import { PAGE_LOAD_WAIT_MS } from '../public-layout/page-load-wait-ms';
import { PlainTestPage } from '../shell/testing/test-pages';
import { FindPage } from './find-page';
import { browseResults, COED_RESULTS, SUNDAY_4S_ROW } from './testing/find-data';

const SEARCH = 'search:programs';
const BROWSE = 'search:programsBrowse';

let client: FakeConvexClient;

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function open(url = '/programs?q=coed'): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'programs', component: FindPage },
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

async function elapse(harness: RouterTestingHarness, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await settle(harness);
}

function subscription(name = SEARCH): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const skeleton = (harness: RouterTestingHarness) =>
  host(harness).querySelector('[data-testid="find-skeleton"]');
const alert = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main section [role="alert"]');
const rows = (harness: RouterTestingHarness) =>
  host(harness).querySelectorAll('main section[aria-labelledby="results-heading"] ul > li');

async function search(harness: RouterTestingHarness, q: string): Promise<void> {
  const field = host(harness).querySelector<HTMLInputElement>('main input[name="q"]')!;
  field.value = q;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  host(harness).querySelector<HTMLButtonElement>('main form button[type="submit"]')!.click();
  await settle(harness);
}

describe('FindPage when the search never answers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('replaces the skeleton with the alert and Try again once the wait has passed, and the footer returns', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(alert(harness)).toBeNull();

    await elapse(harness, 1);
    expect(skeleton(harness)).toBeNull();
    expect(text(alert(harness))).toContain('The search could not be completed.');
    expect(alert(harness)?.querySelector('a')?.getAttribute('href')).toBe('/programs?q=coed');
    expect(host(harness).querySelector('[data-page-loading]')).toBeNull();
    expect(host(harness).querySelector('footer')).not.toBeNull();
  });

  it('adds no page-load status and never calls the page unavailable', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS);
    expect(alert(harness)).not.toBeNull();
    expect(host(harness).querySelector('app-page-load-status')).toBeNull();
    expect(text(host(harness))).not.toContain('temporarily unavailable');
  });

  it('shows the results when the held answer arrives after the alert', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS);
    expect(alert(harness)).not.toBeNull();

    subscription().emit(COED_RESULTS);
    await settle(harness);
    expect(alert(harness)).toBeNull();
    expect(rows(harness).length).toBeGreaterThan(0);
    expect(host(harness).querySelector('footer')).not.toBeNull();
  });

  it('never shows the alert when the answer arrives before the wait ends', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    subscription().emit(COED_RESULTS);
    await settle(harness);

    await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
    expect(alert(harness)).toBeNull();
    expect(rows(harness).length).toBeGreaterThan(0);
  });

  it('starts the wait over when the visitor searches again', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1_000);
    await search(harness, 'north beach');
    expect(skeleton(harness)).not.toBeNull();

    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(alert(harness)).toBeNull();

    await elapse(harness, 1);
    expect(alert(harness)?.querySelector('a')?.getAttribute('href')).toBe(
      '/programs?q=north%20beach',
    );
  });

  it('starts the wait over when the answer to one search has come and the next search never answers', async () => {
    const harness = await open();
    subscription().emit(COED_RESULTS);
    await settle(harness);
    await elapse(harness, PAGE_LOAD_WAIT_MS * 2);

    await search(harness, 'north beach');
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    await elapse(harness, 1);
    expect(alert(harness)).not.toBeNull();
  });

  it('keeps the previous page, with no alert, while the next page of a browse loads', async () => {
    const harness = await open('/programs?type=league');
    subscription(BROWSE).emit(browseResults([SUNDAY_4S_ROW], { pageCount: 2, total: 2 }));
    await settle(harness);
    expect(rows(harness)).toHaveLength(1);

    await harness.navigateByUrl('/programs?type=league&page=2');
    await settle(harness);
    await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
    expect(skeleton(harness)).toBeNull();
    expect(alert(harness)).toBeNull();
    expect(rows(harness)).toHaveLength(1);
    expect(host(harness).querySelector('footer')).not.toBeNull();
  });

  describe('offline', () => {
    it('shows the not-saved view with no saved copy, and the wait does not run', async () => {
      stubOnLine(false);
      const harness = await open();
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();

      await elapse(harness, PAGE_LOAD_WAIT_MS * 3);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(alert(harness)).toBeNull();
    });

    it('replaces the alert with the not-saved view, then starts the wait over when back online', async () => {
      const harness = await open();
      await elapse(harness, PAGE_LOAD_WAIT_MS);
      expect(alert(harness)).not.toBeNull();

      stubOnLine(false);
      await settle(harness);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
      expect(alert(harness)).toBeNull();

      stubOnLine(true);
      await settle(harness);
      expect(skeleton(harness)).not.toBeNull();
      await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
      expect(skeleton(harness)).not.toBeNull();
      expect(alert(harness)).toBeNull();

      await elapse(harness, 1);
      expect(alert(harness)).not.toBeNull();
    });
  });
});
