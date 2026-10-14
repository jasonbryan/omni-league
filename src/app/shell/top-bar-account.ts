import { isPlatformServer } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject } from '@angular/core';
import { PRIMARY_OUTLET, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { safeReturnTo, returnToOrApp } from '../core/auth/return-to';
import { AccountLink } from './account-link';
import { injectCurrentUrl } from './current-url';

/**
 * Whether the visitor is signed in is known only in the browser, and only after the session store answers. Until then (a server render, and hydration) the link is "Sign in",
 * so the browser's first render equals the server's and the account link replaces it afterwards, with no hydration mismatch.
 * On `/sign-up` `returnTo` is that page's own `returnTo` (`/app` when it has none or it is not valid), because the page the visitor came from is not this one.
 * As in the skip link (`skipLinkHref`), a server render leaves the query string out of the link: Netlify's CDN may store the HTML, and the browser adds it after hydration.
 */
@Component({
  selector: 'app-top-bar-account',
  imports: [AccountLink, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (auth.signedIn()) {
      <app-account-link />
    } @else if (returnTo(); as returnTo) {
      <a
        routerLink="/sign-in"
        [queryParams]="{ returnTo: returnTo }"
        data-slot="button"
        class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 aria-expanded:bg-muted aria-expanded:text-foreground h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3 ms-auto"
        >Sign in</a
      >
    }
  `,
})
export class TopBarAccount {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly url = injectCurrentUrl();
  private readonly onServer = isPlatformServer(inject(PLATFORM_ID));

  protected readonly returnTo = computed(() => {
    const tree = this.router.parseUrl(this.url());
    const path = (tree.root.children[PRIMARY_OUTLET]?.segments ?? []).map((s) => s.path).join('/');
    if (path === 'sign-in') return null;
    if (path === 'sign-up') {
      const own: unknown = tree.queryParams['returnTo'];
      return returnToOrApp(typeof own === 'string' ? own : null);
    }
    if (this.onServer) {
      tree.queryParams = {};
      tree.fragment = null;
    }
    return safeReturnTo(this.router.serializeUrl(tree));
  });
}
