import { DOCUMENT } from '@angular/common';
import { Injector, afterNextRender, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * The link or button the visitor used belonged to the page that has just gone, so without this focus would drop to `<body>`
 * and a keyboard user would start again from the top bar. It does nothing on the first navigation, which is the page load itself:
 * the browser starts a loaded document at the top, and moving focus there would hide the skip link from the first Tab.
 */
export function focusMainAfterRouteChange(): void {
  const navigation = inject(Router).currentNavigation();
  if (!navigation || navigation.id === 1) return;
  const document = inject(DOCUMENT);
  afterNextRender(() => document.getElementById('main')?.focus(), { injector: inject(Injector) });
}
