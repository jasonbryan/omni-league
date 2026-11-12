import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmCardImports } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';
import type { HomeShapeKind } from './home-shape';

@Component({
  selector: 'app-home-skeleton',
  imports: [HlmCardImports, HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p role="status" class="sr-only">Loading your teams and registrations.</p>
    <div aria-hidden="true">
      @if (shape() === 'new') {
        <div class="mt-6 grid gap-4 md:mt-8 md:grid-cols-2">
          <div hlmCard size="lg" data-slot="home-skeleton-new-user-card">
            <div hlmCardContent class="flex flex-col">
              <span hlmSkeleton class="block size-11 rounded-xl"></span>
              <span hlmSkeleton class="block mt-4 h-7 w-2/3 rounded-md"></span>
              <span hlmSkeleton class="block mt-1 h-4 w-full rounded-md"></span>
              <span hlmSkeleton class="block mt-1 h-4 w-3/4 rounded-md"></span>
              <span hlmSkeleton class="block mt-5 h-11 w-full rounded-lg sm:w-36"></span>
            </div>
          </div>
        </div>
      } @else {
        @if (shape() === 'nextStep') {
          <span
            hlmSkeleton
            data-slot="home-skeleton-next-step"
            class="block mt-6 h-56 w-full rounded-xl sm:h-24 md:mt-8"
          ></span>
        }
        <div class="mt-8 md:mt-10">
          <span
            hlmSkeleton
            data-slot="home-skeleton-heading"
            class="block h-7 w-32 rounded-md"
          ></span>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            @for (card of cards; track card) {
              <div hlmCard data-slot="home-skeleton-card">
                <div hlmCardContent class="flex flex-col gap-3">
                  <span hlmSkeleton class="block h-6 w-1/2 rounded-md"></span>
                  <span hlmSkeleton class="block h-4 w-3/4 rounded-md"></span>
                  <span hlmSkeleton class="block mt-2 h-10 w-full rounded-md"></span>
                  <span hlmSkeleton class="block h-1.5 w-full rounded-full"></span>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class HomeSkeleton {
  /** The default, `list`, leaves out the next-step block, which most users never have. */
  readonly shape = input<HomeShapeKind>('list');

  protected readonly cards = [1, 2];
}
