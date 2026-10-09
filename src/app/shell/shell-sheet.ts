import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  computed,
  inject,
  input,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmButton } from '../ui/button';
import { HlmSheet, HlmSheetClose, HlmSheetContent, HlmSheetPortal } from '../ui/sheet';
import { SheetLinks } from './sheet-links';

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
 * The app shell's phone sheet (#75): the page's sidebar in a helm sheet from the start edge. The
 * shell imports this file with `import()` on the first press of its menu button, so pages load
 * none of the sheet, dialog, or overlay code until then, and the server never renders it. The
 * shell's static menu button is the trigger: it calls `open()` and reads `isOpen()` and
 * `dialogId()` for its ARIA state, and it gets focus back when the sheet closes.
 */
@Component({
  selector: 'app-shell-sheet',
  imports: [
    HlmButton,
    HlmSheet,
    HlmSheetClose,
    HlmSheetContent,
    HlmSheetPortal,
    NgIcon,
    NgTemplateOutlet,
    SheetLinks,
  ],
  providers: [provideIcons({ lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet
      [side]="'left'"
      [aria-label]="'Navigation'"
      [autoFocus]="'[aria-label=&quot;Close navigation&quot;]'"
      [restoreFocus]="returnFocus()"
      (closed)="onClosed()"
    >
      <hlm-sheet-content
        *hlmSheetPortal
        [showCloseButton]="false"
        class="gap-0 bg-sidebar text-base text-sidebar-foreground shadow-xl data-[side=left]:w-72 data-[side=left]:max-w-[calc(100%-3rem)] data-[side=left]:border-r-0"
      >
        <div
          class="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3"
        >
          <span class="flex items-center gap-2 rounded-md text-base font-semibold">
            <ng-container [ngTemplateOutlet]="brand()" />
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
          <ng-container [ngTemplateOutlet]="sidebar()" />
        </div>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class ShellSheet {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly loadPage = inject(LOAD_PAGE);

  /** The page's `appShellSidebar` template. */
  readonly sidebar = input.required<TemplateRef<unknown>>();
  /** The shell's logo and "Omni League" name, shown in the sheet's own top bar. */
  readonly brand = input.required<TemplateRef<unknown>>();
  /** The menu button, which gets focus back on every close. */
  readonly returnFocus = input.required<HTMLElement>();

  private readonly sheet = viewChild.required(HlmSheet);
  readonly isOpen = computed(() => this.sheet().stateComputed() === 'open');
  readonly dialogId = computed(() => this.sheet().id());

  /** The link activated inside the sheet, followed once the sheet has closed. */
  private pendingLink: string | null = null;

  open(): void {
    this.sheet().open();
  }

  protected closeForLink(href: string): void {
    this.pendingLink = href;
    this.sheet().close();
  }

  /**
   * After the overlay detaches: the CDK block scroll strategy has restored the scroll position
   * from before the sheet opened, and focus is back on the menu button, so the jump runs now.
   */
  protected onClosed(): void {
    const href = this.pendingLink;
    this.pendingLink = null;
    if (!href) return;
    const url = new URL(href);
    if (url.origin !== this.document.location.origin) {
      this.loadPage(url.href);
      return;
    }
    const fragment = decodeFragment(url.hash.slice(1));
    // A URL the client router cannot reach loads as a full page, as the link itself would have.
    // The `**` route (#23) matches every primary path, but the router still rejects a chunk that
    // fails to load and an auxiliary outlet no route matches (`/(//evil.com)`).
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
