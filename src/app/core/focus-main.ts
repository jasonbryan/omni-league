import { DOCUMENT } from '@angular/common';
import { Injector, afterNextRender, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Moves focus to `<main id="main">` once the page has rendered, when the visitor reached it by a
 * client-side route change (#127; #114 for the sport view). The link or button they used belonged
 * to the page that has just gone, so without this focus would drop to `<body>` and a keyboard
 * user would start again from the top bar. The skip link and the page's own heading are other
 * routes to the same place; this one is for the route change itself.
 *
 * Call it in an injection context while the navigation is under way (a routed component's
 * constructor). It does nothing on the server, and on the first navigation, which is the page load
 * itself: the browser starts a loaded document at the top, and moving focus there would hide the
 * skip link from the first Tab. A change of query parameters on the same route creates no
 * component, so it moves nothing either.
 */
export function focusMainAfterRouteChange(): void {
  const navigation = inject(Router).currentNavigation();
  if (!navigation || navigation.id === 1) return;
  const document = inject(DOCUMENT);
  afterNextRender(() => document.getElementById('main')?.focus(), { injector: inject(Injector) });
}
