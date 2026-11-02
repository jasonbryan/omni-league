import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ErrorHandler,
  PLATFORM_ID,
  inject,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationError, provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MockInstance } from 'vitest';
import { withQuietNavigationFailure } from './navigation-failure';

@Component({
  selector: 'app-start-test-page',
  template: '<h1>Start page</h1>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StartTestPage {}

const IMPORT_FAILED = 'Importing a module script failed.';
const failedImport = () => Promise.reject(new TypeError(IMPORT_FAILED));

const routes: Routes = [
  { path: 'start', component: StartTestPage },
  { path: 'broken', loadComponent: failedImport },
  {
    path: 'guarded',
    canActivate: [() => inject(Router).parseUrl('/broken')],
    component: StartTestPage,
  },
  {
    path: 'throwing',
    canActivate: [
      () => {
        throw new Error('guard failed');
      },
    ],
    component: StartTestPage,
  },
];

let handleError: ReturnType<typeof vi.fn>;
let rejections: unknown[];
const onRejection = (reason: unknown) => rejections.push(reason);

function configure(...providers: Provider[]): void {
  handleError = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: ErrorHandler, useValue: { handleError } },
      provideRouter(routes, ...withQuietNavigationFailure()),
      ...providers,
    ],
  });
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const heading = (harness: RouterTestingHarness) =>
  (harness.fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent;

describe('withQuietNavigationFailure', () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    rejections = [];
    process.on('unhandledRejection', onRejection);
    consoleError = vi.spyOn(console, 'error');
  });

  afterEach(async () => {
    // An unhandled rejection is reported a task after the promise rejects.
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', onRejection);
    consoleError.mockRestore();
    TestBed.inject(Location).replaceState('/');
  });

  describe('in the browser', () => {
    it('leaves the page and the address as they were when the next page fails to load, and logs nothing', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');

      const navigated = await TestBed.inject(Router).navigateByUrl('/broken');
      await settle(harness);

      expect(navigated).toBe(false);
      expect(heading(harness)).toBe('Start page');
      expect(TestBed.inject(Location).path()).toBe('/start');
      expect(handleError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(rejections).toEqual([]);
    });

    it('leaves no unhandled rejection when a guard redirects to a page that fails to load', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');

      void TestBed.inject(Router).navigateByUrl('/guarded');
      await settle(harness);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(rejections).toEqual([]);
      expect(heading(harness)).toBe('Start page');
      expect(TestBed.inject(Location).path()).toBe('/start');
      expect(handleError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('logs a navigation that fails for another reason, such as a guard that throws, with no unhandled rejection', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');

      const navigated = await TestBed.inject(Router).navigateByUrl('/throwing');
      await settle(harness);

      expect(navigated).toBe(false);
      expect(handleError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: 'guard failed' }),
      );
      expect(TestBed.inject(Location).path()).toBe('/start');
      expect(rejections).toEqual([]);
    });

    it('returns to the page shown when Back or Forward leads to a page that fails to load, and logs nothing', async () => {
      configure();
      const harness = await RouterTestingHarness.create('/start');
      const router = TestBed.inject(Router);
      // The app's bootstrap starts listening for Back and Forward; a test harness does not.
      router.setUpLocationChangeListener();
      const failures: NavigationError[] = [];
      router.events.subscribe((event) => {
        if (event instanceof NavigationError) failures.push(event);
      });

      const location = TestBed.inject(Location);
      location.go('/broken');
      location.go('/start');
      location.back();
      await settle(harness);

      expect(failures.map((failure) => failure.url)).toEqual(['/broken']);
      expect(heading(harness)).toBe('Start page');
      expect(TestBed.inject(Location).path()).toBe('/start');
      expect(handleError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(rejections).toEqual([]);
    });
  });

  it('logs the failure on the server, where no page unloads', async () => {
    configure({ provide: PLATFORM_ID, useValue: 'server' });

    const navigated = await TestBed.inject(Router).navigateByUrl('/broken');

    expect(navigated).toBe(false);
    expect(handleError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: IMPORT_FAILED }),
    );
    expect(rejections).toEqual([]);
  });
});
