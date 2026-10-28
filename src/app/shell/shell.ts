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
  input,
  inputBinding,
  signal,
  viewChild,
  type ComponentRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu } from '@ng-icons/lucide';
import { filter, map } from 'rxjs';
import { AccountRow } from './account-row';
import { HomeSidebar } from './home-sidebar';
import { OfflineNote } from './offline-note';
import type { ShellSheet } from './shell-sheet';
import { ShellSidebar } from './shell-sidebar';
import { skipLinkHref } from './skip-link';

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
  imports: [AccountRow, HomeSidebar, NgIcon, NgTemplateOutlet, OfflineNote],
  providers: [provideIcons({ lucideMenu })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'dropPendingOpen()' },
  template: `
    <a
      [href]="skipHref()"
      (click)="skipToMain($event)"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >Skip to main content</a
    >
    <div class="min-h-dvh bg-background lg:flex lg:[--top-bar-h:0px]">
      <div class="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar lg:block">
        <div class="sticky top-0 flex h-dvh flex-col px-3 py-4">
          <ng-container [ngTemplateOutlet]="sidebarBody" />
        </div>
      </div>
      <div class="flex min-h-dvh min-w-0 flex-1 flex-col">
        <!-- The negative scroll margin cancels html's scroll-padding-top (base.css) on the header and everything in it. The header is always in view, so focusing one of its controls (by Tab, or focus returning to the menu button as the sheet closes) must not scroll the page. -->
        <header
          class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground md:px-4 lg:hidden [&,&_*]:scroll-mt-[calc(-4.5rem-var(--offline-note-h,0px))]"
        >
          <!-- The classes are those of hlmBtn variant="ghost" size="icon-lg", so the server-rendered button needs none of the helm button code. -->
          <button
            #menuButton
            type="button"
            data-slot="button"
            class="data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground size-9 -ms-1.5"
            aria-label="Open navigation"
            aria-haspopup="dialog"
            [attr.aria-expanded]="sheetOpen()"
            [attr.aria-controls]="sheetOpen() ? sheet()?.dialogId() : null"
            (click)="openSheet()"
          >
            <ng-icon name="lucideMenu" class="text-xl" aria-hidden="true" />
          </button>
          <p class="min-w-0 flex-1 truncate text-sm font-semibold">{{ title() }}</p>
          <app-account-row variant="initials" />
        </header>
        <app-offline-note />
        <main #main id="main" tabindex="-1" class="min-w-0 flex-1 focus:outline-none">
          <ng-content />
        </main>
      </div>
    </div>

    <ng-template #sidebarBody>
      <div class="min-h-0 flex-1 overflow-y-auto">
        @if (sidebar(); as sidebar) {
          <ng-container [ngTemplateOutlet]="sidebar.template" />
        } @else if (sidebarPending()) {
          <p role="status" class="sr-only">Loading navigation.</p>
          <div aria-hidden="true" class="flex flex-col gap-2 px-2">
            @for (width of skeletonWidths; track $index) {
              <div [class]="'h-9 rounded-lg bg-muted motion-safe:animate-pulse ' + width"></div>
            }
          </div>
        } @else {
          <app-home-sidebar />
        }
      </div>
      <div class="shrink-0 border-t border-sidebar-border pt-3">
        <app-account-row />
      </div>
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

  /** True while the page waits for the sidebar it will render, so the home sidebar does not show first. */
  readonly sidebarPending = input(false);

  protected readonly sidebar = contentChild(ShellSidebar);
  protected readonly title = computed(
    () => this.sidebar()?.appShellSidebarTitle() ?? 'Omni League',
  );
  protected readonly skeletonWidths = ['w-full', 'w-5/6', 'w-4/6', 'w-5/6'];
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly sidebarBodyTemplate = viewChild.required<TemplateRef<unknown>>('sidebarBody');

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
    const menuButton = this.menuButton()?.nativeElement;
    if (!menuButton) throw new Error('app-shell: no menu button for the sheet');
    // The element injector keeps the shell's providers in reach.
    const ref = createComponent(ShellSheet, {
      environmentInjector: this.environmentInjector,
      elementInjector: this.injector,
      bindings: [
        inputBinding('sidebar', this.sidebarBodyTemplate),
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
