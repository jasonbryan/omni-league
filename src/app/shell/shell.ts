import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  contentChild,
  inject,
  inputBinding,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideTrophy } from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import type { ShellSheet } from './shell-sheet';
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

/**
 * The app shell (#75; "App shell" in design/mockups/61-token-sheet.html): skip link, top bar, the
 * page's sidebar when it supplies an `<ng-template appShellSidebar>` (a column from 1024px, a sheet
 * behind the menu button below), and `<main>`. Each routed page wraps its content column in it.
 * The breakpoint switch is CSS only, so the server and the browser render the same DOM.
 *
 * The menu button is plain markup, rendered on the server and hydrated as is. The sheet
 * (`ShellSheet`: the helm sheet, the CDK dialog, and the helm class merging) is imported on the
 * button's first press, so a page downloads none of that code until a visitor opens the sheet.
 */
@Component({
  selector: 'app-shell',
  imports: [NgIcon, NgTemplateOutlet, RouterLink],
  providers: [provideIcons({ lucideMenu, lucideTrophy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [href]="skipHref()"
      (click)="skipToMain($event)"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >Skip to main content</a
    >
    <div class="flex min-h-dvh flex-col">
      <!-- The negative scroll margin cancels html's scroll-padding-top (base.css) on the header and
           everything in it. The header is always in view, so focusing one of its controls (by Tab,
           or focus returning to the menu button as the sheet closes) must not scroll the page. -->
      <header
        class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground md:px-4 lg:px-6 [&,&_*]:-scroll-mt-18"
      >
        @if (sidebar()) {
          <!-- The classes are those of hlmBtn variant="ghost" size="icon-lg" (shell.spec.ts checks
               them), so the server-rendered button needs none of the helm button code. -->
          <button
            #menuButton
            type="button"
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
    <ng-container #sheetHost />

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

  protected readonly sidebar = contentChild(ShellSidebar);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly brand = viewChild.required<TemplateRef<unknown>>('brand');
  private readonly sheetHost = viewChild.required('sheetHost', { read: ViewContainerRef });

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly skipHref = computed(() => skipLinkHref(this.router, this.url()));

  /** The phone sheet, once the first press of the menu button has loaded it. */
  protected readonly sheet = signal<ShellSheet | null>(null);
  protected readonly sheetOpen = computed(() => this.sheet()?.isOpen() ?? false);
  private sheetLoad: Promise<ShellSheet> | null = null;

  protected skipToMain(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  protected async openSheet(): Promise<void> {
    this.sheetLoad ??= this.loadSheet().catch((error: unknown) => {
      // A failed chunk load is tried again on the next press.
      this.sheetLoad = null;
      throw error;
    });
    (await this.sheetLoad).open();
  }

  private async loadSheet(): Promise<ShellSheet> {
    const { ShellSheet } = await import('./shell-sheet');
    const sidebar = this.sidebar();
    const menuButton = this.menuButton()?.nativeElement;
    if (!sidebar || !menuButton) throw new Error('app-shell: no sidebar for the sheet');
    const ref = this.sheetHost().createComponent(ShellSheet, {
      bindings: [
        inputBinding('sidebar', () => this.sidebar()?.template ?? sidebar.template),
        inputBinding('brand', this.brand),
        inputBinding('returnFocus', () => menuButton),
      ],
    });
    // Renders the helm sheet and registers its content template, which open() needs.
    ref.changeDetectorRef.detectChanges();
    this.sheet.set(ref.instance);
    return ref.instance;
  }
}
