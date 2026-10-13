import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  EnvironmentInjector,
  PLATFORM_ID,
  afterNextRender,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';

/** The path of a router URL: everything before the query string and the fragment. */
function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * Moves focus to `<main id="main">` once the page has rendered, after every client-side route
 * change (#127, #114, #207; ux.md, Navigation). The link or button the visitor used belonged to the
 * page that has just gone, so without this focus would drop to `<body>` and a keyboard or
 * screen-reader user would start again from the top bar. The skip link and the page's own heading
 * are other routes to the same place; this one is for the route change itself.
 *
 * It does nothing:
 * - on the server;
 * - on the first navigation that ends, which is the page load itself: the browser starts a loaded
 *   document at the top, and moving focus there would hide the skip link from the first Tab. This
 *   holds when a guard redirected the load, because the redirect is a second router navigation;
 * - when only the query string or the fragment changed (a page control, the jump to a form, the
 *   skip link): the page stays and its own code decides where focus goes.
 */
export function provideFocusMainAfterNavigation(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const document = inject(DOCUMENT);
    const injector = inject(EnvironmentInjector);
    let shownPath: string | null = null;
    inject(Router).events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const path = pathOf(event.urlAfterRedirects);
      const first = shownPath === null;
      const samePage = path === shownPath;
      shownPath = path;
      if (first || samePage) return;
      afterNextRender(() => document.getElementById('main')?.focus(), { injector });
    });
  });
}
