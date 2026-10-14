import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** The URL is the router's own (not `location`), so a doubled leading slash in the request has been collapsed. */
export function injectCurrentUrl() {
  const router = inject(Router);
  return toSignal(
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => router.url),
    ),
    { initialValue: router.url },
  );
}
