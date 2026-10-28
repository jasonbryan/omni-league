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

/** The shell imports this file with `import()` on the first press of its menu button, so pages load none of the sheet, dialog, or overlay code until then, and the server never renders it. */
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
        <div class="flex shrink-0 justify-end px-3 pt-3">
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
          class="mt-1 flex min-h-0 flex-1 flex-col px-3 pb-3"
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

  readonly sidebar = input.required<TemplateRef<unknown>>();
  readonly returnFocus = input.required<HTMLElement>();

  private readonly sheet = viewChild.required(HlmSheet);
  readonly isOpen = computed(() => this.sheet().stateComputed() === 'open');
  readonly dialogId = computed(() => this.sheet().id());

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
