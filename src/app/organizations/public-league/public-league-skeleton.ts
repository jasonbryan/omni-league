import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { HlmCard } from '../../ui/card';
import { CRUMB_BOX, CRUMB_LIST, LEAGUE_HEADING } from './public-league-header-classes';
import type { PublicPageNames } from './public-page-names';

const FILL = 'block bg-muted motion-safe:animate-pulse';
const BAR = `rounded-md ${FILL}`;

/** Its heading sits where the page's `h1` does, so the page replaces it without a jump. */
@Component({
  selector: 'app-public-league-skeleton',
  imports: [HlmCard, NgIcon],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'league-skeleton', 'data-page-loading': '' },
  template: `
    <p role="status" class="sr-only">Loading the league.</p>
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
            <span class="${CRUMB_BOX}">{{ names.league.sportName }}</span>
          </li>
        </ol>
        <p data-testid="skeleton-heading" aria-hidden="true" class="${LEAGUE_HEADING}">
          {{ names.league.name }}
        </p>
      } @else {
        <div
          data-testid="skeleton-breadcrumb-row"
          class="flex h-5 items-center pointer-coarse:h-11"
        >
          <span aria-hidden="true" class="${BAR} h-4 w-64 md:h-5"></span>
        </div>
        <span
          data-testid="skeleton-heading"
          aria-hidden="true"
          class="${BAR} mt-4 h-9 w-4/5 md:mt-6 md:h-12 md:w-1/2"
        ></span>
      }
      <span aria-hidden="true" class="${BAR} mt-2 h-6 w-40 md:mt-3 md:h-7"></span>
      <span aria-hidden="true" class="${BAR} mt-1 h-6 w-3/5 md:h-7 md:w-1/3"></span>
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 py-8 md:px-8 md:py-12 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <span aria-hidden="true" class="${BAR} h-7 w-48"></span>
          <div hlmCard size="bare" class="mt-5 flex flex-col gap-3 p-5 md:p-6">
            <span aria-hidden="true" class="${BAR} h-6 w-40"></span>
            <span aria-hidden="true" class="${BAR} h-4 w-3/4"></span>
            <span aria-hidden="true" class="${BAR} h-11 w-full md:w-40"></span>
          </div>
          <div class="mt-10 divide-y divide-border">
            @for (row of rows; track row) {
              <div class="flex flex-col gap-2 py-4">
                <span aria-hidden="true" class="${BAR} h-5 w-1/3"></span>
                <span aria-hidden="true" class="${BAR} h-4 w-1/2"></span>
                <span aria-hidden="true" class="${FILL} h-5 w-32 rounded-full"></span>
              </div>
            }
          </div>
        </div>
        <div class="mt-10 lg:mt-0">
          <span aria-hidden="true" class="${BAR} h-7 w-40"></span>
          <span aria-hidden="true" class="${BAR} mt-4 h-14 w-full"></span>
        </div>
      </div>
    </div>
  `,
})
export class PublicLeagueSkeleton {
  readonly names = input<PublicPageNames>();
  protected readonly rows = [1, 2];
}
