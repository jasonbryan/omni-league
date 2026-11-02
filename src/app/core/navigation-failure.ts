import { isPlatformBrowser } from '@angular/common';
import { ErrorHandler, PLATFORM_ID, inject } from '@angular/core';
import { withNavigationErrorHandler, withRouterConfig, type RouterFeatures } from '@angular/router';

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
