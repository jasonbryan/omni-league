import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import {
  CRUMB_BOX,
  CRUMB_LIST,
  LEAGUE_HEADING,
} from '../public-league/public-league-header-classes';
import type { PublicCampNames } from './public-camp-names';

const BAR = 'block rounded-md';

/** Its heading sits where the page's `h1` does, so the page replaces it without a jump. */
@Component({
  selector: 'app-public-camp-skeleton',
  imports: [HlmCard, HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'camp-skeleton', 'data-page-loading': '' },
  template: `
    <p role="status" class="sr-only">Loading the camp.</p>
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      @if (names(); as names) {
        <ol data-testid="skeleton-breadcrumb" aria-hidden="true" class="${CRUMB_LIST}">
          <li>
            <span class="${CRUMB_BOX}">{{ names.organization.name }}</span>
          </li>
        </ol>
        <p data-testid="skeleton-heading" aria-hidden="true" class="${LEAGUE_HEADING}">
          {{ names.camp.name }}
        </p>
      } @else {
        <div
          data-testid="skeleton-breadcrumb-row"
          class="flex h-5 items-center pointer-coarse:h-11"
        >
          <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-40 md:h-5"></span>
        </div>
        <span
          hlmSkeleton
          data-testid="skeleton-heading"
          aria-hidden="true"
          class="${BAR} mt-4 h-9 w-4/5 md:mt-6 md:h-12 md:w-1/2"
        ></span>
      }
      <span hlmSkeleton aria-hidden="true" class="${BAR} mt-2 h-6 w-32 md:mt-3 md:h-7"></span>
      <span hlmSkeleton aria-hidden="true" class="${BAR} mt-1 h-6 w-3/5 md:h-7 md:w-1/3"></span>
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <div class="py-8 md:py-10 lg:col-span-2 lg:row-start-1">
          <div aria-hidden="true" hlmCard size="bare" class="overflow-hidden">
            <div class="border-b border-border px-4 py-3 md:px-5">
              <span hlmSkeleton aria-hidden="true" class="${BAR} h-5 w-24"></span>
            </div>
            <div class="divide-y divide-border">
              @for (row of rows; track row) {
                <div class="px-4 py-4 md:px-5">
                  <span hlmSkeleton aria-hidden="true" class="${BAR} h-5 w-24"></span>
                  <span
                    hlmSkeleton
                    aria-hidden="true"
                    class="${BAR} mt-2 h-4 w-48 max-w-full"
                  ></span>
                  <span hlmSkeleton aria-hidden="true" class="${BAR} mt-1.5 h-4 w-32"></span>
                </div>
              }
            </div>
          </div>
        </div>
        <div class="pb-8 md:pb-10 lg:col-start-3 lg:row-start-1 lg:py-10">
          @for (fact of facts; track fact) {
            <div class="flex gap-4 py-4">
              <span hlmSkeleton aria-hidden="true" class="block size-10 shrink-0 rounded-lg"></span>
              <div class="flex-1 space-y-2">
                <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-20"></span>
                <span hlmSkeleton aria-hidden="true" class="${BAR} h-5 w-40"></span>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class PublicCampSkeleton {
  readonly names = input<PublicCampNames>();
  protected readonly rows = [1, 2, 3];
  protected readonly facts = [1, 2];
}
