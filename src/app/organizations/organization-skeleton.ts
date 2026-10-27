import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const BAR = 'block rounded-md bg-muted motion-safe:animate-pulse';

/** The bars of a list while its rows load; the caller says what is loading. */
@Component({
  selector: 'app-organization-rows-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="divide-y divide-border">
      @for (row of rows(); track row) {
        <div class="flex flex-col gap-2 py-4">
          <span aria-hidden="true" class="${BAR} h-5 w-1/2"></span>
          @if (kind() === 'league') {
            <span aria-hidden="true" class="${BAR} h-4 w-1/3"></span>
            <span aria-hidden="true" class="${BAR} h-4 w-2/3"></span>
          } @else {
            <span aria-hidden="true" class="${BAR} h-4 w-2/3"></span>
            <span aria-hidden="true" class="${BAR} h-3 w-1/4"></span>
          }
        </div>
      }
    </div>
  `,
})
export class OrganizationRowsSkeleton {
  readonly kind = input.required<'league' | 'location'>();

  protected readonly rows = computed(() => (this.kind() === 'league' ? [1, 2, 3] : [1, 2]));
}

@Component({
  selector: 'app-organization-skeleton',
  imports: [OrganizationRowsSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'organization-skeleton' },
  template: `
    <p role="status" class="sr-only">Loading the organization.</p>
    <div class="mx-auto w-full max-w-6xl px-4 pt-6 pb-6 md:px-8 md:pt-12 md:pb-10">
      <div class="flex items-start gap-3 md:items-center md:gap-4">
        <span
          aria-hidden="true"
          class="${BAR} mt-0.5 size-8 shrink-0 rounded-lg md:mt-0 md:size-12 md:rounded-xl"
        ></span>
        <span aria-hidden="true" class="${BAR} h-8 w-3/4 md:h-12 md:w-2/3"></span>
      </div>
      <span aria-hidden="true" class="${BAR} mt-2 h-6 w-3/5 md:mt-3 md:h-7 md:w-1/3"></span>
    </div>
    <div class="border-b border-border pb-4 md:pb-6">
      <div class="mx-auto flex w-full max-w-6xl flex-wrap gap-2 px-4 md:px-8">
        @for (width of chipWidths; track $index) {
          <span
            aria-hidden="true"
            class="${BAR} h-11 rounded-full md:h-9 pointer-coarse:min-h-11"
            [class]="width"
          ></span>
        }
      </div>
    </div>
    <div class="mx-auto w-full max-w-6xl px-4 md:px-8">
      <div class="grid gap-x-12 lg:grid-cols-3">
        <div class="py-8 md:py-12 lg:col-span-2">
          <span aria-hidden="true" class="${BAR} h-7 w-32"></span>
          <app-organization-rows-skeleton kind="league" class="mt-2 block" />
        </div>
        <div class="border-t border-border py-8 md:py-12 lg:border-t-0">
          <span aria-hidden="true" class="${BAR} h-7 w-32"></span>
          <app-organization-rows-skeleton kind="location" class="mt-4 block" />
        </div>
      </div>
    </div>
  `,
})
export class OrganizationSkeleton {
  protected readonly chipWidths = ['w-28', 'w-40', 'w-24', 'w-24'];
}
