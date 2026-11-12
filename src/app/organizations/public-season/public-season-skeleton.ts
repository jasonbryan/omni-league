import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { HlmCard } from '../../ui/card';
import { HlmSkeleton } from '../../ui/skeleton';
import { CRUMB_BOX, CRUMB_LIST } from '../public-league/public-league-header-classes';
import type { PublicPageNames } from '../public-league/public-page-names';
import {
  SEASON_CRUMB_CURRENT,
  SEASON_HEADING,
} from '../public-league/public-season-header-classes';

const BAR = 'block rounded-md';

/**
 * Given the names a link carried, its breadcrumb and heading are text set like the page's, so they wrap as the page's do. Without them, below 640px
 * the breadcrumb and the heading each wrap to two lines, so the bars reserve two of each and the page replaces them without a shift.
 */
@Component({
  selector: 'app-public-season-skeleton',
  imports: [HlmCard, HlmSkeleton, NgIcon],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'season-skeleton', 'data-page-loading': '' },
  template: `
    <p role="status" class="sr-only">Loading the season.</p>
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      @if (names(); as names) {
        <ol data-testid="skeleton-breadcrumb" aria-hidden="true" class="${CRUMB_LIST}">
          <li>
            <span class="${CRUMB_BOX}">{{ names.organization.name }}</span>
          </li>
          <li>
            <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" />
          </li>
          <li>
            <span class="${CRUMB_BOX}">{{ names.league.name }}</span>
          </li>
          <li>
            <ng-icon name="lucideChevronRight" class="translate-y-0.5 text-sm" />
          </li>
          <li>
            <span class="${SEASON_CRUMB_CURRENT}">{{ names.season?.name }}</span>
          </li>
        </ol>
      } @else {
        <div class="flex flex-col">
          <div
            data-testid="skeleton-breadcrumb-row"
            class="flex h-5 items-center pointer-coarse:h-11"
          >
            <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-48 md:h-5 md:w-64"></span>
          </div>
          <div
            data-testid="skeleton-breadcrumb-row"
            class="flex h-5 items-center pointer-coarse:h-11 sm:hidden"
          >
            <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-40"></span>
          </div>
        </div>
      }
      <div class="mt-4 flex gap-2 md:mt-6">
        <span hlmSkeleton aria-hidden="true" class="block h-5.5 w-28 rounded-full"></span>
        <span hlmSkeleton aria-hidden="true" class="block h-5.5 w-32 rounded-full"></span>
      </div>
      @if (names(); as names) {
        <p data-testid="season-skeleton-heading" aria-hidden="true" class="${SEASON_HEADING}">
          {{ names.league.name }}&nbsp;&middot; {{ names.season?.name }}
        </p>
      } @else {
        <div class="mt-3 flex h-18 flex-col gap-2 sm:h-9 md:h-12">
          <span
            hlmSkeleton
            aria-hidden="true"
            data-testid="season-skeleton-heading"
            class="${BAR} h-7 w-4/5 md:h-12 md:w-1/2"
          ></span>
          <span hlmSkeleton aria-hidden="true" class="${BAR} h-7 w-1/2 sm:hidden"></span>
        </div>
      }
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <div class="pt-2 lg:col-start-3 lg:row-start-1 lg:pt-10">
          <div data-testid="season-skeleton-card" hlmCard size="bare" class="p-5 md:p-6">
            <span hlmSkeleton aria-hidden="true" class="${BAR} h-7 w-full"></span>
            <div class="mt-4 flex h-10 flex-col justify-between">
              <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-full"></span>
              <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-2/3"></span>
            </div>
            <span hlmSkeleton aria-hidden="true" class="${BAR} mt-5 h-11 w-full"></span>
          </div>
        </div>
        <div
          data-testid="season-skeleton-details"
          class="py-8 md:py-10 lg:col-span-2 lg:row-start-1"
        >
          <div class="grid sm:grid-cols-2 sm:gap-x-8">
            @for (fact of facts; track fact) {
              <div class="flex gap-4 py-4">
                <span
                  hlmSkeleton
                  aria-hidden="true"
                  class="block size-10 shrink-0 rounded-lg"
                ></span>
                <div class="flex-1 space-y-2">
                  <span hlmSkeleton aria-hidden="true" class="${BAR} h-4 w-20"></span>
                  <span hlmSkeleton aria-hidden="true" class="${BAR} h-5 w-40"></span>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PublicSeasonSkeleton {
  readonly names = input<PublicPageNames>();
  protected readonly facts = [1, 2, 3, 4];
}
