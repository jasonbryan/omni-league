import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from '../../core/data/convex';
import {
  FakeConvexClient,
  type FakeSubscription,
} from '../../core/data/convex/testing/fake-convex-client';
import { PAGE_STALLED_ANNOUNCEMENT } from '../../public-layout/page-load-status';
import { PAGE_LOAD_WAIT_MS } from '../../public-layout/page-load-wait-ms';
import { PlainTestPage } from '../../shell/testing/test-pages';
import { PublicLeaguePage } from './public-league-page';
import { at, leagueQueryResults, OPEN_DAY } from './testing/league-data';

const PATH = '/organizations/gulf-coast-sport-social/leagues/sunday-reverse-coed-4s';
const OTHER_PATH = '/organizations/gulf-coast-sport-social/leagues/saturday-coed-6s';

let client: FakeConvexClient;

function stubOnLine(value: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

async function open(url = PATH): Promise<RouterTestingHarness> {
  client = new FakeConvexClient();
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

async function elapse(harness: RouterTestingHarness, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await settle(harness);
}

function subscription(name: string): FakeSubscription {
  const active = client.activeSubscriptions.filter((s) => s.name === name);
  expect(active, name).toHaveLength(1);
  return active[0];
}

async function answer(harness: RouterTestingHarness): Promise<void> {
  for (const [name, value] of Object.entries(leagueQueryResults())) subscription(name).emit(value);
  await settle(harness);
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const skeleton = (harness: RouterTestingHarness) =>
  host(harness).querySelector('[data-testid="league-skeleton"]');
const errorView = (harness: RouterTestingHarness) =>
  host(harness).querySelector('app-server-error-view');
const announcement = (harness: RouterTestingHarness) =>
  host(harness).querySelector('main app-page-load-status [role="status"]');

describe('PublicLeaguePage when no query answers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(at(OPEN_DAY));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows the unavailable view with Try again to its own path once the wait has passed, and drops the skeleton', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(errorView(harness)).toBeNull();

    await elapse(harness, 1);
    expect(skeleton(harness)).toBeNull();
    expect(text(errorView(harness)?.querySelector('h1'))).toBe(
      'This page is temporarily unavailable',
    );
    expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(PATH);
    expect(TestBed.inject(Title).getTitle()).toBe('Temporarily unavailable | Omni League');
  });

  it('leaves no page-loading mark in the layout, so the footer shows', async () => {
    const harness = await open();
    expect(host(harness).querySelector('[data-page-loading]')).not.toBeNull();

    await elapse(harness, PAGE_LOAD_WAIT_MS);
    expect(host(harness).querySelector('[data-page-loading]')).toBeNull();
    expect(host(harness).querySelector('footer')).not.toBeNull();
  });

  it('shows the page when the held answer arrives after the error view', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS);
    expect(errorView(harness)).not.toBeNull();

    await answer(harness);
    expect(errorView(harness)).toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Sunday Reverse Coed 4s');
    expect(TestBed.inject(Title).getTitle()).toBe(
      'Sunday Reverse Coed 4s | Gulf Coast Sport & Social | Omni League',
    );
  });

  it('never shows the error view when the answer arrives before the wait ends', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    await answer(harness);

    await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
    expect(errorView(harness)).toBeNull();
    expect(text(host(harness).querySelector('main h1'))).toBe('Sunday Reverse Coed 4s');
  });

  it('starts the wait over when the visitor navigates to another league', async () => {
    const harness = await open();
    await elapse(harness, PAGE_LOAD_WAIT_MS - 1_000);
    await harness.navigateByUrl(OTHER_PATH);
    await settle(harness);

    await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
    expect(skeleton(harness)).not.toBeNull();
    expect(errorView(harness)).toBeNull();

    await elapse(harness, 1);
    expect(errorView(harness)?.querySelector('a')?.getAttribute('href')).toBe(OTHER_PATH);
  });

  describe('offline', () => {
    it('shows the not-saved view with no saved copy, and the wait does not run', async () => {
      stubOnLine(false);
      const harness = await open();
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();

      await elapse(harness, PAGE_LOAD_WAIT_MS * 3);
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      expect(errorView(harness)).toBeNull();
    });

    it('replaces the error view with the not-saved view, then starts the wait over when back online', async () => {
      const harness = await open();
      await elapse(harness, PAGE_LOAD_WAIT_MS);
      expect(errorView(harness)).not.toBeNull();

      stubOnLine(false);
      await settle(harness);
      expect(errorView(harness)).toBeNull();
      expect(host(harness).querySelector('app-not-saved-view')).not.toBeNull();
      await elapse(harness, PAGE_LOAD_WAIT_MS * 2);
      expect(errorView(harness)).toBeNull();

      stubOnLine(true);
      await settle(harness);
      expect(skeleton(harness)).not.toBeNull();
      await elapse(harness, PAGE_LOAD_WAIT_MS - 1);
      expect(skeleton(harness)).not.toBeNull();
      expect(errorView(harness)).toBeNull();

      await elapse(harness, 1);
      expect(errorView(harness)).not.toBeNull();
    });
  });

  describe('announcement', () => {
    it('fills a status region that was already empty in the page, and leaves focus where it was', async () => {
      const harness = await open();
      const region = announcement(harness);
      expect(region).not.toBeNull();
      expect(region?.textContent).toBe('');
      const focused = document.activeElement;

      await elapse(harness, PAGE_LOAD_WAIT_MS);
      expect(errorView(harness)).not.toBeNull();
      expect(announcement(harness)).toBe(region);
      expect(region?.textContent).toBe(PAGE_STALLED_ANNOUNCEMENT);
      expect(document.activeElement).toBe(focused);
    });

    it('empties the region when the held answer arrives', async () => {
      const harness = await open();
      const region = announcement(harness);
      await elapse(harness, PAGE_LOAD_WAIT_MS);

      await answer(harness);
      expect(announcement(harness)).toBe(region);
      expect(region?.textContent).toBe('');
    });
  });
});
