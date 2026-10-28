import { ChangeDetectionStrategy, Component } from '@angular/core';

const BAR = 'block rounded-md bg-muted motion-safe:animate-pulse';

/** Its heading bar sits where the page's `h1` does, so the page replaces it without a jump. */
@Component({
  selector: 'app-public-league-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'league-skeleton', 'data-page-loading': '' },
  template: `
    <p role="status" class="sr-only">Loading the league.</p>
    <div class="mx-auto w-full max-w-6xl px-4 pt-4 pb-6 md:px-8 md:pt-8 md:pb-10">
      <div class="flex h-11 items-center md:h-5">
        <span aria-hidden="true" class="${BAR} h-4 w-64 md:h-5"></span>
      </div>
      <span aria-hidden="true" class="${BAR} mt-4 h-9 w-4/5 md:mt-6 md:h-12 md:w-1/2"></span>
      <span aria-hidden="true" class="${BAR} mt-2 h-6 w-40 md:mt-3 md:h-7"></span>
      <span aria-hidden="true" class="${BAR} mt-1 h-6 w-3/5 md:h-7 md:w-1/3"></span>
    </div>
    <div class="border-t border-border">
      <div class="mx-auto grid w-full max-w-6xl gap-x-12 px-4 py-8 md:px-8 md:py-12 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <span aria-hidden="true" class="${BAR} h-7 w-48"></span>
          <div
            class="mt-5 flex flex-col gap-3 rounded-xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10 md:p-6"
          >
            <span aria-hidden="true" class="${BAR} h-6 w-40"></span>
            <span aria-hidden="true" class="${BAR} h-4 w-3/4"></span>
            <span aria-hidden="true" class="${BAR} h-11 w-full md:w-40"></span>
          </div>
          <div class="mt-10 divide-y divide-border">
            @for (row of rows; track row) {
              <div class="flex flex-col gap-2 py-4">
                <span aria-hidden="true" class="${BAR} h-5 w-1/3"></span>
                <span aria-hidden="true" class="${BAR} h-4 w-1/2"></span>
                <span aria-hidden="true" class="${BAR} h-5 w-32 rounded-full"></span>
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
  protected readonly rows = [1, 2];
}
