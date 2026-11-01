import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ApplicationRef,
  ErrorHandler,
  PLATFORM_ID,
  InjectionToken,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type Type,
} from '@angular/core';
import {
  RedirectCommand,
  Router,
  withNavigationErrorHandler,
  withRouterConfig,
  type Route,
  type RouterFeatures,
} from '@angular/router';

export const PAGE_UNAVAILABLE_PATH = 'page-unavailable';

/** A leaving page's imports fail as its navigation starts, and it hides only when the next document arrives, which on a slow phone network takes seconds. */
export const UNLOAD_COMMIT_WAIT_MS = 10_000;

const SHOW_PAGE_UNAVAILABLE = Symbol();

/**
 * True from `beforeunload` until the wait ends, so an unload that did not happen (a download link, a
 * declined prompt) stops counting. The server never unloads, so its listener never runs, and a root
 * provider lives as long as the page, so the listener is never removed.
 */
const PAGE_LEAVING = new InjectionToken('', {
  factory: () => {
    const leave = { leaving: false };
    inject(DOCUMENT).defaultView?.addEventListener('beforeunload', () => {
      leave.leaving = true;
      setTimeout(() => (leave.leaving = false), UNLOAD_COMMIT_WAIT_MS);
    });
    return leave;
  },
});

/** Matches only the navigations the handler starts, so its address shows the not-found page. */
export function pageUnavailableRoute(loadComponent: () => Promise<Type<unknown>>): Route {
  return {
    path: PAGE_UNAVAILABLE_PATH,
    canMatch: [() => inject(Router).currentNavigation()?.extras.info === SHOW_PAGE_UNAVAILABLE],
    loadComponent,
  };
}

/**
 * A failed navigation (a lazy page that did not load) shows the page-unavailable view at the address
 * asked for, and a failure while the page unloads is ignored: WebKit cancels a leaving page's imports.
 * Without a handler the router rejects a promise that nothing awaits when the failed navigation
 * followed a guard's redirect.
 */
export function withPageLoadFailureView(): RouterFeatures[] {
  return [
    withNavigationErrorHandler((error) => {
      const router = inject(Router);
      if (inject(PAGE_LEAVING).leaving) return undefined;
      // Offline a page that is not on the device cannot load, which is no error. Node's navigator has no onLine.
      if (navigator.onLine !== false) inject(ErrorHandler).handleError(error.error);
      // The view's own load failed: the page stays.
      if (router.currentNavigation()?.extras.info === SHOW_PAGE_UNAVAILABLE) return undefined;
      return new RedirectCommand(router.parseUrl(`/${PAGE_UNAVAILABLE_PATH}`), {
        browserUrl: error.url,
        info: SHOW_PAGE_UNAVAILABLE,
      });
    }),
    // A failure the handler leaves alone resolves the navigation's promise with false instead of rejecting it.
    withRouterConfig({ resolveNavigationPromiseOnError: true }),
  ];
}

/**
 * Starts listening for `beforeunload` at bootstrap, so a failure that follows it is known to be part of
 * leaving. Once the app is stable it loads the page-unavailable view, which offline could not load when
 * a failure needs it.
 */
export function providePageLeaveTracking(loadView: () => Promise<unknown>): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(PAGE_LEAVING);
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    void inject(ApplicationRef)
      .whenStable()
      .then(loadView)
      .catch(() => undefined);
  });
}
