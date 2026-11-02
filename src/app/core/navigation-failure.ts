import { isPlatformBrowser } from '@angular/common';
import { ErrorHandler, PLATFORM_ID, inject } from '@angular/core';
import { withNavigationErrorHandler, withRouterConfig, type RouterFeatures } from '@angular/router';

/**
 * WebKit fails a leaving page's lazy imports, and after a guard's redirect the router rejects a
 * promise that nothing awaits. The browser cannot tell those aborts from real failures, so it logs
 * none; the server never unloads, so it logs every one.
 */
export function withQuietNavigationFailure(): RouterFeatures[] {
  return [
    withRouterConfig({ resolveNavigationPromiseOnError: true }),
    withNavigationErrorHandler((failure) => {
      if (!isPlatformBrowser(inject(PLATFORM_ID))) inject(ErrorHandler).handleError(failure.error);
    }),
  ];
}
