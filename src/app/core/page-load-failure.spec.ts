import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, ErrorHandler, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { CONVEX_CLIENT } from './data/convex';
import { FakeConvexClient } from './data/convex/testing/fake-convex-client';
import { provideFocusMainAfterNavigation } from './focus-main';
import {
  PAGE_UNAVAILABLE_PATH,
  UNLOAD_COMMIT_WAIT_MS,
  pageUnavailableRoute,
  providePageLeaveTracking,
  withPageLoadFailureView,
} from './page-load-failure';

@Component({
  selector: 'app-start-test-page',
  template: '<main id="main" tabindex="-1"><h1>Start page</h1><a href="/broken">Broken</a></main>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StartTestPage {}

const IMPORT_FAILED = 'Importing a module script failed.';
const failedImport = () => Promise.reject(new TypeError(IMPORT_FAILED));

const loadPageUnavailablePage = () =>
  import('../server-error/page-unavailable-page').then((m) => m.PageUnavailablePage);

const routes: Routes = [
  { path: 'start', component: StartTestPage },
  { path: 'broken', loadComponent: failedImport },
  { path: 'app/broken', loadComponent: failedImport },
  {
    path: 'guarded',
    canActivate: [() => inject(Router).parseUrl('/broken')],
    component: StartTestPage,
  },
  pageUnavailableRoute(loadPageUnavailablePage),
  { path: '**', component: StartTestPage },
];

let handleError: ReturnType<typeof vi.fn>;
let loadView: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
let rejections: unknown[];
const onRejection = (event: PromiseRejectionEvent) => rejections.push(event.reason);

function configure(routeConfig: Routes = routes): void {
  handleError = vi.fn();
  loadView = vi.fn(loadPageUnavailablePage);
  TestBed.configureTestingModule({
    providers: [
      { provide: CONVEX_CLIENT, useValue: new FakeConvexClient() },
      { provide: ErrorHandler, useValue: { handleError } },
      provideRouter(routeConfig, ...withPageLoadFailureView()),
      providePageLeaveTracking(loadView),
      provideFocusMainAfterNavigation(),
    ],
  });
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const host = (harness: RouterTestingHarness) => harness.fixture.nativeElement as HTMLElement;
const heading = (harness: RouterTestingHarness) => host(harness).querySelector('h1');
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tryAgain = (harness: RouterTestingHarness) =>
  [...host(harness).querySelectorAll('main a')].find((a) => text(a) === 'Try again');

describe('withPageLoadFailureView', () => {
  beforeEach(() => {
    rejections = [];
    window.addEventListener('unhandledrejection', onRejection);
  });

  afterEach(async () => {
    // An unhandled rejection is reported a task after the promise rejects.
    await new Promise((resolve) => setTimeout(resolve, 10));
    window.removeEventListener('unhandledrejection', onRejection);
    expect(rejections).toEqual([]);
    TestBed.inject(Location).replaceState('/');
  });

  describe('online, with no unload in flight', () => {
    it('shows the server-error view at the address asked for, with Try again and its heading focused', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      await TestBed.inject(Router).navigateByUrl('/broken?q=harbor#seasons');
      await settle(harness);

      expect(text(heading(harness))).toBe('This page is temporarily unavailable');
      expect(host(harness).querySelector('header')).not.toBeNull();
      expect(tryAgain(harness)?.getAttribute('href')).toBe('/broken?q=harbor');
      expect(document.activeElement).toBe(heading(harness));
      expect(TestBed.inject(Location).path(true)).toBe('/broken?q=harbor#seasons');
      expect(handleError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: IMPORT_FAILED }),
      );
    });

    it('shows the view in the app shell for a page under /app', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      await TestBed.inject(Router).navigateByUrl('/app/broken');
      await settle(harness);

      expect(text(heading(harness))).toBe('This page is temporarily unavailable');
      expect(host(harness).querySelector('app-shell')).not.toBeNull();
      expect(tryAgain(harness)?.getAttribute('href')).toBe('/app/broken');
      expect(TestBed.inject(Location).path()).toBe('/app/broken');
    });

    it('leaves no unhandled rejection when a guard redirects to a page whose load fails', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      await TestBed.inject(Router).navigateByUrl('/guarded');
      await settle(harness);

      expect(text(heading(harness))).toBe('This page is temporarily unavailable');
      expect(TestBed.inject(Location).path()).toBe('/broken');
      expect(tryAgain(harness)?.getAttribute('href')).toBe('/broken');
    });

    it('drops a one-time sign-in token from Try again', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      await TestBed.inject(Router).navigateByUrl('/broken?ott=secret&page=2');
      await settle(harness);

      expect(tryAgain(harness)?.getAttribute('href')).toBe('/broken?page=2');
    });

    it('stays on the page and logs both failures when the page-unavailable view fails to load too', async () => {
      configure([
        { path: 'start', component: StartTestPage },
        { path: 'broken', loadComponent: failedImport },
        pageUnavailableRoute(failedImport),
      ]);
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      await TestBed.inject(Router).navigateByUrl('/broken');
      await settle(harness);

      expect(text(heading(harness))).toBe('Start page');
      expect(handleError).toHaveBeenCalledTimes(2);
    });

    it('cannot be opened by its own address', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      await TestBed.inject(Router).navigateByUrl(`/${PAGE_UNAVAILABLE_PATH}`);
      await settle(harness);

      expect(text(heading(harness))).toBe('Start page');
    });
  });

  it('shows the not-saved view instead when offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    configure();
    const harness = await RouterTestingHarness.create('/start');
    await settle(harness);

    await TestBed.inject(Router).navigateByUrl('/broken');
    await settle(harness);

    expect(text(heading(harness))).toBe("This page isn't saved on this device");
    expect(tryAgain(harness)?.getAttribute('href')).toBe('/broken');
    expect(handleError).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('loads the view once the app is stable, so it is on the device before a failure offline', async () => {
    configure();
    const harness = await RouterTestingHarness.create('/start');
    await settle(harness);

    expect(loadView).toHaveBeenCalledOnce();
  });

  describe('while the page unloads', () => {
    it('ignores the failed import: nothing is logged and the page and address stay', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);
      const consoleError = vi.spyOn(console, 'error');

      window.dispatchEvent(new Event('beforeunload'));
      await TestBed.inject(Router).navigateByUrl('/broken');
      await settle(harness);

      expect(text(heading(harness))).toBe('Start page');
      expect(TestBed.inject(Location).path()).toBe('/start');
      expect(handleError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('ignores a failure after a guard redirected the page load, and leaves no unhandled rejection', async () => {
      configure();
      const harness = await RouterTestingHarness.create();

      window.dispatchEvent(new Event('beforeunload'));
      await TestBed.inject(Router).navigateByUrl('/guarded');
      await settle(harness);

      expect(heading(harness)).toBeNull();
      expect(handleError).not.toHaveBeenCalled();
    });

    it('stops ignoring after the wait when the page did not unload (a download link, a declined prompt)', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      await settle(harness);

      vi.useFakeTimers({ toFake: ['setTimeout'] });
      window.dispatchEvent(new Event('beforeunload'));
      vi.advanceTimersByTime(UNLOAD_COMMIT_WAIT_MS);
      vi.useRealTimers();
      await TestBed.inject(Router).navigateByUrl('/broken');
      await settle(harness);

      expect(text(heading(harness))).toBe('This page is temporarily unavailable');
      expect(handleError).toHaveBeenCalledOnce();
    });
  });
});
