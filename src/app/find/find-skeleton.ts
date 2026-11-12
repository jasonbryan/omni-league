import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmSkeleton } from '../ui/skeleton';

const BAR = 'block rounded-md';

/** Shaped like the count line (a search has one) and three result rows, so the results replace it without a jump. */
@Component({
  selector: 'app-find-skeleton',
  imports: [HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'find-skeleton' },
  template: `
    <p role="status" class="sr-only">Searching.</p>
    @if (withCount()) {
      <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-56"></span>
    }
    <div class="mt-2 max-w-3xl divide-y divide-border">
      @for (row of rows; track row) {
        <div class="flex items-center gap-4 py-4">
          <span hlmSkeleton aria-hidden="true" class="block size-11 shrink-0 rounded-xl"></span>
          <div class="flex-1 space-y-2">
            <span hlmSkeleton aria-hidden="true" class="${BAR} h-5 w-1/2"></span>
            <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-3/4"></span>
            <span hlmSkeleton aria-hidden="true" class="block h-5 w-32 rounded-full"></span>
          </div>
        </div>
      }
    </div>
  `,
})
export class FindSkeleton {
  readonly withCount = input(true);

  protected readonly rows = [1, 2, 3];
}
