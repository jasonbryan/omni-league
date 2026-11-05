import { isPlatformBrowser, Location } from '@angular/common';
import {
  ErrorHandler,
  PLATFORM_ID,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import {
  NavigationError,
  Router,
  withNavigationErrorHandler,
  withRouterConfig,
  type RouterFeatures,
} from '@angular/router';

/** The `TypeError` text WebKit, Chromium, and Firefox give an `import()` whose chunk did not load. */
const CHUNK_LOAD_FAILURE =
  /^(?:Importing a module script failed\.|Failed to fetch dynamically imported module|error loading dynamically imported module)/;

const isChunkLoadFailure = (error: unknown): boolean =>
  error instanceof TypeError && CHUNK_LOAD_FAILURE.test(error.message);

/**
 * After a guard's redirect the router rejects a promise that nothing awaits. WebKit fails a leaving
 * page's lazy imports, and the browser cannot tell that abort from a chunk that failed to load, so it
 * skips chunk failures; the network log still records a chunk that failed on the wire.
 */
export function withQuietNavigationFailure(): RouterFeatures[] {
  return [
    withRouterConfig({ resolveNavigationPromiseOnError: true }),
    withNavigationErrorHandler((failure) => {
      if (isPlatformBrowser(inject(PLATFORM_ID)) && isChunkLoadFailure(failure.error)) return;
      inject(ErrorHandler).handleError(failure.error);
    }),
  ];
}

/**
 * A failed navigation resets the address to the router's own URL, which is `/` until a navigation succeeds.
 * WebKit runs that reset on a page that a link already started leaving, and it rewrites the page's history entry, so Back lands on `/`.
 * The address the browser loaded is put back when the first navigation fails to load a chunk.
 */
export function provideLoadedAddressOnFailedFirstNavigation(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const router = inject(Router);
    const location = inject(Location);
    const loaded = { path: location.path(true), state: location.getState() };
    router.events.subscribe((event) => {
      if (
        event instanceof NavigationError &&
        isChunkLoadFailure(event.error) &&
        !router.navigated &&
        location.path(true) !== loaded.path
      ) {
        location.replaceState(loaded.path, '', loaded.state);
      }
    });
  });
}
