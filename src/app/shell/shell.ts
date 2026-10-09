import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InjectionToken,
  computed,
  contentChild,
  inject,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideTrophy, lucideX } from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import { HlmButton } from '../ui/button';
import {
  HlmSheet,
  HlmSheetClose,
  HlmSheetContent,
  HlmSheetPortal,
  HlmSheetTrigger,
} from '../ui/sheet';
import { SheetLinks } from './sheet-links';
import { ShellSidebar } from './shell-sidebar';

/**
 * The skip link's `href`: the router's current URL with its fragment set to `main`. A bare `#main`
 * would resolve to `/#main` (the home page) because of `<base href="/">`. The router's URL is the
 * source, not `location` or the request URL, which keep a doubled leading slash. The serializer
 * collapses `//evil.com/x` to `/evil.com/x`, but an empty primary segment beside an auxiliary
 * route still serializes with a leading `//` (`/(//evil.com)` gives `//evil.com`, which is also
 * `router.url` for that request). So leading slashes and backslashes, which a browser reads as the
 * start of another host, collapse to one slash.
 */
export function skipLinkHref(router: Router, url: string): string {
  const tree = router.parseUrl(url);
  tree.fragment = 'main';
  return router.serializeUrl(tree).replace(/^[/\\]+/, '/');
}

/** Loads a URL as a full page load (`location.assign`); a token so unit tests can observe it. */
export const LOAD_PAGE = new InjectionToken<(url: string) => void>('LOAD_PAGE', {
  factory: () => {
    const document = inject(DOCUMENT);
    return (url) => {
      document.location.assign(url);
    };
  },
});

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * The app shell (#75; "App shell" in design/mockups/61-token-sheet.html): skip link, top bar, the
 * page's sidebar when it supplies an `<ng-template appShellSidebar>` (a column from 1024px, a sheet
 * behind the menu button below), and `<main>`. Each routed page wraps its content column in it.
 * The breakpoint switch is CSS only, so the server and the browser render the same DOM.
 */
@Component({
  selector: 'app-shell',
  imports: [
    HlmButton,
    HlmSheet,
    HlmSheetClose,
    HlmSheetContent,
    HlmSheetPortal,
    HlmSheetTrigger,
    NgIcon,
    NgTemplateOutlet,
    RouterLink,
    SheetLinks,
  ],
  providers: [provideIcons({ lucideMenu, lucideTrophy, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [href]="skipHref()"
      (click)="skipToMain($event)"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >Skip to main content</a
    >
    <div class="flex min-h-dvh flex-col">
      <header
        class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground md:px-4 lg:px-6"
      >
        @if (sidebar(); as sidebar) {
          <hlm-sheet
            class="flex lg:hidden"
            [side]="'left'"
            [aria-label]="'Navigation'"
            [autoFocus]="'[aria-label=&quot;Close navigation&quot;]'"
            [restoreFocus]="menuButton"
            (closed)="onSheetClosed()"
          >
            <button
              #menuButton
              hlmBtn
              hlmSheetTrigger
              type="button"
              variant="ghost"
              size="icon-lg"
              class="-ms-1.5"
              aria-label="Open navigation"
            >
              <ng-icon name="lucideMenu" class="text-xl" aria-hidden="true" />
            </button>
            <hlm-sheet-content
              *hlmSheetPortal
              [showCloseButton]="false"
              class="gap-0 bg-sidebar text-base text-sidebar-foreground shadow-xl data-[side=left]:w-72 data-[side=left]:max-w-[calc(100%-3rem)] data-[side=left]:border-r-0"
            >
              <div
                class="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3"
              >
                <span class="flex items-center gap-2 rounded-md text-base font-semibold">
                  <ng-container [ngTemplateOutlet]="brand" />
                </span>
                <button
                  hlmBtn
                  hlmSheetClose
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Close navigation"
                >
                  <ng-icon name="lucideX" class="text-xl" aria-hidden="true" />
                </button>
              </div>
              <div
                appSheetLinks
                class="flex-1 overflow-y-auto px-3 py-5"
                (linkActivated)="closeForLink($event)"
              >
                <ng-container [ngTemplateOutlet]="sidebar.template" />
              </div>
            </hlm-sheet-content>
          </hlm-sheet>
        }
        <a routerLink="/" class="flex items-center gap-2 rounded-md text-base font-semibold">
          <ng-container [ngTemplateOutlet]="brand" />
        </a>
      </header>
      <div class="flex flex-1">
        @if (sidebar(); as sidebar) {
          <div class="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar lg:block">
            <div class="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto px-3 py-5">
              <ng-container [ngTemplateOutlet]="sidebar.template" />
            </div>
          </div>
        }
        <main #main id="main" tabindex="-1" class="min-w-0 flex-1 focus:outline-none">
          <ng-content />
        </main>
      </div>
    </div>

    <ng-template #brand>
      <span
        class="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
      >
        <ng-icon name="lucideTrophy" class="text-lg" aria-hidden="true" />
      </span>
      Omni League
    </ng-template>
  `,
})
export class Shell {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly loadPage = inject(LOAD_PAGE);

  protected readonly sidebar = contentChild(ShellSidebar);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly sheet = viewChild(HlmSheet);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly skipHref = computed(() => skipLinkHref(this.router, this.url()));

  /** The link activated inside the sheet, followed once the sheet has closed. */
  private pendingLink: string | null = null;

  protected skipToMain(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  protected closeForLink(href: string): void {
    this.pendingLink = href;
    this.sheet()?.close();
  }

  /**
   * After the overlay detaches: the CDK block scroll strategy has restored the scroll position
   * from before the sheet opened, and focus is back on the menu button, so the jump runs now.
   */
  protected onSheetClosed(): void {
    const href = this.pendingLink;
    this.pendingLink = null;
    if (!href) return;
    const url = new URL(href);
    if (url.origin !== this.document.location.origin) {
      this.loadPage(url.href);
      return;
    }
    const fragment = decodeFragment(url.hash.slice(1));
    // A URL the client router cannot reach (no matching route, a chunk that fails to load) loads
    // as a full page, as the link itself would have.
    this.router.navigateByUrl(url.pathname + url.search + url.hash).then(
      () => {
        if (fragment) this.document.getElementById(fragment)?.scrollIntoView();
      },
      () => {
        this.loadPage(url.href);
      },
    );
  }
}
