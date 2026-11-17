import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmSkeleton } from '../ui/skeleton';

const BAR = 'block rounded-md';

/** Shaped like the count line (a search has one) and three result rows, each as tall as a row with its type, division, place, and status lines, so the results replace it without a jump. */
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
          <div class="min-w-0 flex-1">
            <span hlmSkeleton aria-hidden="true" class="${BAR} h-6 w-1/2"></span>
            <span
              hlmSkeleton
              aria-hidden="true"
              class="mt-0.5 block h-5.5 w-2/3 rounded-full"
            ></span>
            <span hlmSkeleton aria-hidden="true" class="${BAR} mt-0.5 h-5 w-3/4"></span>
            <span hlmSkeleton aria-hidden="true" class="mt-2 block h-5.5 w-40 rounded-full"></span>
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
