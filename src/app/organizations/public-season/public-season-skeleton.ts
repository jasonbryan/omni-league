import { ChangeDetectionStrategy, Component } from '@angular/core';

const BAR = 'block rounded-md bg-muted motion-safe:animate-pulse';

/** At phone widths the breadcrumb and the heading each wrap to two lines, so the skeleton reserves two of each and the page replaces it without a shift. */
@Component({
  selector: 'app-public-season-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'season-skeleton' },
  template: `
    <p role="status" class="sr-only">Loading the season.</p>
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      <div class="flex flex-col md:h-5">
        <div class="flex h-11 items-center md:h-5">
          <span aria-hidden="true" class="${BAR} h-4 w-48 md:h-5 md:w-64"></span>
        </div>
        <div class="flex h-11 items-center md:hidden">
          <span aria-hidden="true" class="${BAR} h-4 w-40"></span>
        </div>
      </div>
      <div class="mt-4 flex gap-2 md:mt-6">
        <span aria-hidden="true" class="${BAR} h-5.5 w-28 rounded-full"></span>
        <span aria-hidden="true" class="${BAR} h-5.5 w-32 rounded-full"></span>
      </div>
      <div class="mt-3 flex h-18 flex-col gap-2 md:h-12">
        <span
          aria-hidden="true"
          data-testid="season-skeleton-heading"
          class="${BAR} h-7 w-4/5 md:h-12 md:w-1/2"
        ></span>
        <span aria-hidden="true" class="${BAR} h-7 w-1/2 md:hidden"></span>
      </div>
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 md:px-8 lg:grid-cols-3">
        <div class="pt-2 lg:col-start-3 lg:row-start-1 lg:pt-10">
          <div
            data-testid="season-skeleton-card"
            class="rounded-xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10 md:p-6"
          >
            <span aria-hidden="true" class="${BAR} h-7 w-full"></span>
            <div class="mt-4 flex h-10 flex-col justify-between">
              <span aria-hidden="true" class="${BAR} h-4 w-full"></span>
              <span aria-hidden="true" class="${BAR} h-4 w-2/3"></span>
            </div>
            <span aria-hidden="true" class="${BAR} mt-5 h-11 w-full"></span>
          </div>
        </div>
        <div
          data-testid="season-skeleton-details"
          class="py-8 md:py-10 lg:col-span-2 lg:row-start-1"
        >
          <div class="grid sm:grid-cols-2 sm:gap-x-8">
            @for (fact of facts; track fact) {
              <div class="flex gap-4 py-4">
                <span aria-hidden="true" class="${BAR} size-10 shrink-0 rounded-lg"></span>
                <div class="flex-1 space-y-2">
                  <span aria-hidden="true" class="${BAR} h-4 w-20"></span>
                  <span aria-hidden="true" class="${BAR} h-5 w-40"></span>
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
  protected readonly facts = [1, 2, 3, 4];
}
