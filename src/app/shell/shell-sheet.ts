import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  viewChild,
  type TemplateRef,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmButton } from '../ui/button';
import { HlmSheet, HlmSheetClose, HlmSheetContent, HlmSheetPortal } from '../ui/sheet';
import { FollowLink } from './follow-link';
import { SheetLinks } from './sheet-links';

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
  private readonly followLink = inject(FollowLink);

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
    this.followLink.follow(href);
  }
}
