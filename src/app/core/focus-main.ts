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

function withoutQueryOrFragment(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

export function provideFocusMainAfterNavigation(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const document = inject(DOCUMENT);
    const injector = inject(EnvironmentInjector);
    let shownPath: string | null = null;
    inject(Router).events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const path = withoutQueryOrFragment(event.urlAfterRedirects);
      const isPageLoad = shownPath === null;
      const onlyQueryOrFragmentChanged = path === shownPath;
      shownPath = path;
      // A page load leaves the first Tab for the skip link; after a query or fragment change the
      // page sets focus itself.
      if (isPageLoad || onlyQueryOrFragmentChanged) return;
      afterNextRender(() => document.getElementById('main')?.focus(), { injector });
    });
  });
}
