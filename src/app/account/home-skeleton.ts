import { ChangeDetectionStrategy, Component } from '@angular/core';

const PULSE = 'block bg-muted motion-safe:animate-pulse';

@Component({
  selector: 'app-home-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <p role="status" class="sr-only">Loading your teams.</p>
    <div aria-hidden="true">
      <span class="${PULSE} mt-6 h-56 w-full rounded-xl sm:h-24 md:mt-8"></span>
      <div class="mt-8 md:mt-10">
        <span data-slot="home-skeleton-heading" class="${PULSE} h-7 w-32 rounded-md"></span>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          @for (card of cards; track card) {
            <div
              data-slot="home-skeleton-card"
              class="flex flex-col gap-3 p-5 rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
            >
              <span class="${PULSE} h-6 w-1/2 rounded-md"></span>
              <span class="${PULSE} h-4 w-3/4 rounded-md"></span>
              <span class="${PULSE} mt-2 h-10 w-full rounded-md"></span>
              <span class="${PULSE} h-1.5 w-full rounded-full"></span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class HomeSkeleton {
  protected readonly cards = [1, 2];
}
