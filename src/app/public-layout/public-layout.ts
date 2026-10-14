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
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTrophy } from '@ng-icons/lucide';
import { injectCurrentUrl } from '../shell/current-url';
import { OfflineNote } from '../shell/offline-note';
import { skipLinkHref } from '../shell/shell';
import { TopBarAccount } from '../shell/top-bar-account';

/** The link classes of the footer's groups: 44px tall on a phone, as drawn in the mockup. */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center rounded-md hover:text-foreground hover:underline md:min-h-0';

/**
 * The public layout (design/mockups/300-public-site-navigation.html and the frame of
 * design/mockups/300-public-site-organization.html, style A): every page outside
 * `/app/**` wraps its content in it. A skip link, a light top bar ("Omni League", then "Sign in"
 * or the account link), the offline note directly below the bar, `<main id="main">`, and a
 * footer. There is no menu button and no sidebar. The app shell (`src/app/shell/`) is for
 * `/app/**` only.
 *
 * It holds no per-user value: "Sign in" and the account link are `TopBarAccount`, which shows the
 * account link only in the browser, once the session store answers. The server's HTML (cached by
 * the CDN for Server routes) is therefore the same for every visitor, and the query string stays
 * out of it, as in the shell (`skipLinkHref`). The new-version prompt is an overlay
 * the app provides once (`provideUpdatePrompt`), so it appears here without markup.
 *
 * The top bar is 64px tall plus its 1px border, so the offline note sticks below it with
 * `--top-bar-h`. "Sign in" and the account link reuse the shell's `TopBarAccount`; the layout only
 * raises their height to 44px on a phone with a descendant selector, as the mockup draws it.
 */
@Component({
  selector: 'app-public-layout',
  imports: [NgIcon, NgTemplateOutlet, OfflineNote, RouterLink, TopBarAccount],
  providers: [provideIcons({ lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [href]="skipHref()"
      (click)="skipToMain($event)"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >Skip to main content</a
    >
    <div class="flex min-h-dvh flex-col bg-card [--top-bar-h:calc(4rem+1px)]">
      <!-- The negative scroll margin cancels html's scroll-padding-top (base.css, which adds the
           offline note's height, --offline-note-h) on the header and everything in it, as in the
           app shell: the header is always in view, so focusing one of its controls must not
           scroll the page. -->
      <header
        class="sticky top-0 z-30 border-b border-border bg-card [&,&_*]:scroll-mt-[calc(-4.5rem-var(--offline-note-h,0px))]"
      >
        <div class="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:gap-6 md:px-8">
          <a
            routerLink="/"
            class="flex min-h-11 shrink-0 items-center gap-2 rounded-md text-base font-semibold"
          >
            <ng-container [ngTemplateOutlet]="brand" />
          </a>
          <div
            class="ms-auto flex shrink-0 items-center [&_a]:min-h-11 md:[&_a]:min-h-0 [&_a[href^='/sign-in']]:px-4 md:[&_a[href^='/sign-in']]:px-3"
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
                class="flex min-h-11 shrink-0 items-center gap-2 rounded-md text-base font-semibold"
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
                <ul role="list" class="mt-2 text-muted-foreground md:mt-3 md:space-y-2">
                  <li>
                    <a routerLink="/app" [class]="footerLink">Your account</a>
                  </li>
                </ul>
              </div>
              <div>
                <h2 class="font-medium">Organizers</h2>
                <ul role="list" class="mt-2 text-muted-foreground md:mt-3 md:space-y-2">
                  <li>
                    <a routerLink="/app/organizations/new" [class]="footerLink"
                      >Create an organization</a
                    >
                  </li>
                  <li>
                    <a
                      routerLink="/sign-in"
                      [queryParams]="{ returnTo: '/app' }"
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
  // The server leaves the query string out of the HTML (see skipLinkHref); the browser puts it
  // back on hydration. Before hydration the link reloads the page without the query string.
  private readonly onServer = isPlatformServer(inject(PLATFORM_ID));
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  protected readonly footerLink = FOOTER_LINK;
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
