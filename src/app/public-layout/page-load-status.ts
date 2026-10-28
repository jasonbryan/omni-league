import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export const PAGE_STALLED_ANNOUNCEMENT = 'This page is temporarily unavailable.';

/**
 * The region stays in the page from the first render and is empty until the wait ends: a live region that is inserted already holding its text is often not announced.
 * It sits after the page's views so the skeleton's own status stays the first one in `main`.
 */
@Component({
  selector: 'app-page-load-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `<p role="status" class="sr-only">{{ stalled() ? announcement : '' }}</p>`,
})
export class PageLoadStatus {
  readonly stalled = input.required<boolean>();

  protected readonly announcement = PAGE_STALLED_ANNOUNCEMENT;
}
