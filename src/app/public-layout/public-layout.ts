import { NgTemplateOutlet, isPlatformServer } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { PRIMARY_OUTLET, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrophy } from '@ng-icons/lucide';
import { injectCurrentUrl } from '../shell/current-url';
import { OfflineNote } from '../shell/offline-note';
import { skipLinkHref } from '../shell/skip-link';
import { injectSignInReturnTo } from '../shell/sign-in-return-to';
import { TopBarAccount } from '../shell/top-bar-account';
import { TopBarFind } from './top-bar-find';

const FOOTER_LINK_CLASSES =
  'inline-flex items-center rounded-md hover:text-foreground hover:underline pointer-coarse:min-h-11';

/**
 * "Sign in" and the account link come from `TopBarAccount`, which shows the account link only in the browser: the server HTML is cached by the CDN,
 * so nothing here depends on the visitor, and the query string stays out of the HTML (`skipLinkHref`).
 */
@Component({
  selector: 'app-public-layout',
  imports: [NgIcon, NgTemplateOutlet, OfflineNote, RouterLink, TopBarAccount, TopBarFind],
  providers: [provideIcons({ lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [href]="skipHref()"
      (click)="skipToMain($event)"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >Skip to main content</a
    >
    <!-- A page skeleton is taller than a short page, so the footer would jump up when the content arrives; it is left out until then. -->
    <div
      class="flex min-h-dvh flex-col bg-card [--top-bar-h:calc(4rem+1px)] [&:has([data-page-loading])>footer]:hidden"
    >
      <!-- The header is always in view, so focusing one of its controls must not scroll the page. -->
      <header
        class="sticky top-0 z-30 border-b border-border bg-card [&,&_*]:scroll-mt-[calc(-4.5rem-var(--offline-note-h,0px))]"
      >
        <!-- The field sits in the middle column and the account side in the last, so neither moves when the account link replaces "Sign in". -->
        <div
          class="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:grid md:grid-cols-[minmax(max-content,1fr)_minmax(0,24rem)_minmax(0,1fr)] md:gap-6 md:px-8"
        >
          <a
            routerLink="/"
            class="flex min-h-11 shrink-0 items-center gap-2 rounded-md text-base font-semibold md:justify-self-start"
          >
            <ng-container [ngTemplateOutlet]="brand" />
          </a>
          @if (showFind()) {
            <app-top-bar-find />
          }
          <div
            class="ms-auto flex min-w-0 items-center md:col-start-3 md:ms-0 md:justify-end [&_a[href='/app']]:shrink pointer-coarse:[&_a]:min-h-11 [&_a[href^='/sign-in']]:px-3 pointer-coarse:[&_a[href^='/sign-in']]:px-4"
          >
            <app-top-bar-account />
          </div>
        </div>
      </header>
      <app-offline-note />
      <main #main id="main" tabindex="-1" class="min-w-0 flex-1 focus:outline-none">
        <ng-content />
      </main>
      <footer class="border-t border-border bg-muted">
        <div class="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-12">
          <div class="flex flex-col gap-8 md:flex-row md:justify-between">
            <div class="max-w-xs">
              <a
                routerLink="/"
                class="flex pointer-coarse:min-h-11 shrink-0 items-center gap-2 rounded-md text-base font-semibold"
              >
                <ng-container [ngTemplateOutlet]="brand" />
              </a>
              <p class="mt-3 text-sm text-muted-foreground">
                Recreational leagues for beach volleyball, soccer, and softball.
              </p>
            </div>
            <nav aria-label="Footer" class="grid grid-cols-2 gap-x-12 gap-y-8 text-sm">
              <div>
                <h2 class="font-medium">Players</h2>
                <ul
                  role="list"
                  class="mt-2 text-muted-foreground md:mt-3 md:space-y-2 pointer-fine:space-y-2"
                >
                  <li>
                    <a routerLink="/leagues" [class]="footerLink">Find a league</a>
                  </li>
                  <li>
                    <a routerLink="/app" [class]="footerLink">Your account</a>
                  </li>
                </ul>
              </div>
              <div>
                <h2 class="font-medium">Organizers</h2>
                <ul
                  role="list"
                  class="mt-2 text-muted-foreground md:mt-3 md:space-y-2 pointer-fine:space-y-2"
                >
                  <li>
                    <a routerLink="/app/organizations/new" [class]="footerLink"
                      >Create an organization</a
                    >
                  </li>
                  <li>
                    <a
                      routerLink="/sign-in"
                      [queryParams]="{ returnTo: signIn().returnTo }"
                      [class]="footerLink"
                      >Sign in to manage</a
                    >
                  </li>
                </ul>
              </div>
            </nav>
          </div>
          <div class="mt-8 border-t border-border pt-6 text-sm text-muted-foreground md:mt-10">
            <p>&copy; 2026 Omni League</p>
          </div>
        </div>
      </footer>
    </div>

    <ng-template #brand>
      <span
        class="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
      >
        <ng-icon name="lucideTrophy" class="text-lg" aria-hidden="true" />
      </span>
      Omni League
    </ng-template>
  `,
})
export class PublicLayout {
  private readonly router = inject(Router);
  private readonly url = injectCurrentUrl();
  // The server renders the link without the query string (CDN-cached HTML); the browser adds it on hydration.
  private readonly onServer = isPlatformServer(inject(PLATFORM_ID));
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  protected readonly signIn = injectSignInReturnTo();
  protected readonly footerLink = FOOTER_LINK_CLASSES;
  // The search page has a larger field of its own.
  protected readonly showFind = computed(() => {
    const segments = this.router.parseUrl(this.url()).root.children[PRIMARY_OUTLET]?.segments ?? [];
    return !(segments.length === 1 && segments[0]?.path === 'leagues');
  });
  protected readonly skipHref = computed(() =>
    skipLinkHref(this.router, this.url(), !this.onServer),
  );

  protected skipToMain(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
