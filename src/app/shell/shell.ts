import { NgTemplateOutlet, isPlatformServer } from '@angular/common';
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  InjectionToken,
  Injector,
  PLATFORM_ID,
  TemplateRef,
  computed,
  contentChild,
  createComponent,
  inject,
  inputBinding,
  signal,
  viewChild,
  type ComponentRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideTrophy } from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import { OfflineNote } from './offline-note';
import type { ShellSheet } from './shell-sheet';
import { ShellSidebar } from './shell-sidebar';
import { TopBarAccount } from './top-bar-account';

/**
 * A bare `#main` would resolve to `/#main` because of `<base href="/">`. The router's URL is the source, not `location`, and leading slashes and backslashes collapse to one,
 * since a browser reads them as the start of another host (`/(//evil.com)` serializes to `//evil.com`). With `withQuery` false the query string is dropped:
 * Netlify's CDN may store the HTML of a public page, and a query string can carry a one-time token.
 */
export function skipLinkHref(router: Router, url: string, withQuery = true): string {
  const tree = router.parseUrl(url);
  tree.fragment = 'main';
  if (!withQuery) tree.queryParams = {};
  return router.serializeUrl(tree).replace(/^[/\\]+/, '/');
}

/** Imports the phone sheet's chunk. A token so that tests can hold the import back. */
export const LOAD_SHELL_SHEET = new InjectionToken<() => Promise<typeof import('./shell-sheet')>>(
  'LOAD_SHELL_SHEET',
  { factory: () => () => import('./shell-sheet') },
);

/**
 * The sheet is imported on the menu button's first press, so a page downloads none of its code until a visitor opens it. A press waiting on that import is dropped by Escape,
 * a navigation, or the shell's destruction, so the sheet never opens over the next page. The sheet has no anchor in this template: a view container here would be server-rendered
 * and break hydration. It is created with `createComponent` and its host view attached to `ApplicationRef`; the helm sheet renders through the CDK overlay, so its host element stays out of the document.
 */
@Component({
  selector: 'app-shell',
  imports: [NgIcon, NgTemplateOutlet, OfflineNote, RouterLink, TopBarAccount],
  providers: [provideIcons({ lucideMenu, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dropPendingOpen()' },
  template: `
    <a
      [href]="skipHref()"
      (click)="skipToMain($event)"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >Skip to main content</a
    >
    <div class="flex min-h-dvh flex-col">
      <!-- The negative scroll margin cancels html's scroll-padding-top (base.css) on the header and everything in it. The header is always in view, so focusing one of its controls (by Tab, or focus returning to the menu button as the sheet closes) must not scroll the page. -->
      <header
        class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground md:px-4 lg:px-6 [&,&_*]:scroll-mt-[calc(-4.5rem-var(--offline-note-h,0px))]"
      >
        @if (sidebar()) {
          <!-- The classes are those of hlmBtn variant="ghost" size="icon-lg", so the server-rendered button needs none of the helm button code. -->
          <button
            #menuButton
            type="button"
            data-slot="button"
            class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground size-9 -ms-1.5 lg:hidden"
            aria-label="Open navigation"
            aria-haspopup="dialog"
            [attr.aria-expanded]="sheetOpen()"
            [attr.aria-controls]="sheetOpen() ? sheet()?.dialogId() : null"
            (click)="openSheet()"
          >
            <ng-icon name="lucideMenu" class="text-xl" aria-hidden="true" />
          </button>
        }
        <a
          routerLink="/"
          class="flex items-center gap-2 rounded-md text-base font-semibold pointer-coarse:min-h-11"
        >
          <ng-container [ngTemplateOutlet]="brand" />
        </a>
        <app-top-bar-account />
      </header>
      <app-offline-note />
      <div class="flex flex-1">
        @if (sidebar(); as sidebar) {
          <div class="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar lg:block">
            <div
              class="sticky top-[calc(3.5rem+var(--offline-note-h,0px))] max-h-[calc(100dvh-3.5rem-var(--offline-note-h,0px))] overflow-y-auto px-3 py-5"
            >
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly loadShellSheet = inject(LOAD_SHELL_SHEET);
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);

  protected readonly sidebar = contentChild(ShellSidebar);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly brand = viewChild.required<TemplateRef<unknown>>('brand');

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  // The server leaves the query string out of the HTML (see skipLinkHref); the browser puts it
  // back on hydration. Before hydration the link reloads the page without the query string.
  private readonly onServer = isPlatformServer(inject(PLATFORM_ID));
  protected readonly skipHref = computed(() =>
    skipLinkHref(this.router, this.url(), !this.onServer),
  );

  protected readonly sheet = signal<ShellSheet | null>(null);
  protected readonly sheetOpen = computed(() => this.sheet()?.isOpen() ?? false);
  private sheetLoad: Promise<ShellSheet | null> | null = null;
  private openPending = false;
  private sheetRef: ComponentRef<ShellSheet> | null = null;

  constructor() {
    // Destroying the sheet's ComponentRef also detaches its view from ApplicationRef, and the helm
    // sheet closes its dialog: no scrim or scroll block stays on the next page.
    this.destroyRef.onDestroy(() => {
      this.sheetRef?.destroy();
      this.sheetRef = null;
    });
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.dropPendingOpen();
      });
  }

  protected dropPendingOpen(): void {
    this.openPending = false;
  }

  protected skipToMain(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  protected async openSheet(): Promise<void> {
    this.openPending = true;
    this.sheetLoad ??= this.loadSheet().catch((error: unknown) => {
      // A failed chunk load is tried again on the next press.
      this.sheetLoad = null;
      throw error;
    });
    const sheet = await this.sheetLoad;
    if (!this.openPending) return;
    this.openPending = false;
    // A navigation under way may destroy the shell in the same turn as the sheet opens, which
    // would leave its scrim and scroll block on the next page.
    if (!sheet || this.destroyRef.destroyed || this.router.currentNavigation()) return;
    sheet.open();
  }

  private async loadSheet(): Promise<ShellSheet | null> {
    const { ShellSheet } = await this.loadShellSheet();
    // The shell's onDestroy has already run, so a sheet created now would never be destroyed and
    // could still open over the next page.
    if (this.destroyRef.destroyed) return null;
    const sidebar = this.sidebar();
    const menuButton = this.menuButton()?.nativeElement;
    if (!sidebar || !menuButton) throw new Error('app-shell: no sidebar for the sheet');
    // The element injector keeps the shell's providers in reach.
    const ref = createComponent(ShellSheet, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
      bindings: [
        inputBinding('sidebar', () => this.sidebar()?.template ?? sidebar.template),
        inputBinding('brand', this.brand),
        inputBinding('returnFocus', () => menuButton),
      ],
    });
    this.sheetRef = ref;
    this.appRef.attachView(ref.hostView);
    try {
      ref.changeDetectorRef.detectChanges();
    } catch (error) {
      // A sheet that failed to render must not stay attached: the next press creates its own.
      ref.destroy();
      this.sheetRef = null;
      throw error;
    }
    this.sheet.set(ref.instance);
    return ref.instance;
  }
}
