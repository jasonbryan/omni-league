import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmSkeleton } from '../ui/skeleton';

const BAR = 'block rounded-md';

// A phone wraps a row's text by an amount a skeleton cannot know, so its rows take the height of the shortest wrapped row.
@Component({
  selector: 'app-find-skeleton',
  imports: [HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'find-skeleton', 'data-page-loading': '' },
  template: `
    <p role="status" class="sr-only">Searching.</p>
    @if (withCount()) {
      <span aria-hidden="true" class="relative block min-h-5 text-sm">
        <span class="invisible block">{{ countText() }}</span>
        <span hlmSkeleton class="${BAR} absolute top-0 start-0 h-5 w-56"></span>
      </span>
    }
    <div class="mt-2 max-w-3xl divide-y divide-border">
      @for (row of rows; track row) {
        <div class="flex items-center gap-4 py-4">
          <span hlmSkeleton aria-hidden="true" class="block size-11 shrink-0 rounded-xl"></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-col gap-1">
              <span
                hlmSkeleton
                aria-hidden="true"
                class="${BAR} h-5.5 w-3/4 sm:h-6 sm:w-1/2"
              ></span>
              <span hlmSkeleton aria-hidden="true" class="${BAR} h-5.5 w-1/2 sm:hidden"></span>
            </div>
            <span
              hlmSkeleton
              aria-hidden="true"
              class="mt-0.5 block h-5.5 w-2/3 rounded-full"
            ></span>
            <span hlmSkeleton aria-hidden="true" class="${BAR} mt-0.5 h-5 w-3/4"></span>
            <div class="mt-2 flex flex-col gap-1 sm:hidden">
              <span hlmSkeleton aria-hidden="true" class="${BAR} h-3.5 w-full"></span>
              <span hlmSkeleton aria-hidden="true" class="${BAR} h-3.5 w-1/2"></span>
            </div>
            <span
              hlmSkeleton
              aria-hidden="true"
              class="mt-2 block h-5.5 w-40 rounded-full max-sm:hidden"
            ></span>
          </div>
        </div>
      }
    </div>
  `,
})
export class FindSkeleton {
  readonly withCount = input(true);
  /** The words of the count line, drawn invisibly under the bar so the line wraps as the loaded one does. */
  readonly countText = input('');

  protected readonly rows = [1, 2, 3];
}
