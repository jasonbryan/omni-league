import { ChangeDetectionStrategy, Component } from '@angular/core';

const PULSE = 'rounded-md bg-muted motion-safe:animate-pulse';
const PANEL =
  'overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';

/** There is no sidebar column yet: the shell draws one only once there is a sidebar to show. */
@Component({
  selector: 'app-league-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <p role="status" class="sr-only">Loading the league.</p>
    <div aria-hidden="true" data-slot="crumb-row" class="flex h-5 items-center pointer-coarse:h-11">
      <div class="${PULSE} h-4 w-40"></div>
    </div>
    <div aria-hidden="true" class="${PULSE} mt-1 h-8 w-56 md:h-9"></div>
    <div aria-hidden="true" class="${PULSE} mt-2 h-5 w-44"></div>
    <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
      <div aria-hidden="true" class="${PANEL} lg:col-span-2">
        <div class="border-b border-border px-4 py-3 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-5 w-24"></div>
        </div>
        <div class="divide-y divide-border">
          @for (row of rows; track row) {
            <div class="flex gap-3 px-4 py-3.5 md:px-5">
              <div class="flex-1">
                <div aria-hidden="true" class="${PULSE} h-4 w-40 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-56 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-48 max-w-full"></div>
              </div>
            </div>
          }
        </div>
      </div>
      <div aria-hidden="true" class="${PANEL}">
        <div class="border-b border-border px-4 py-3 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-5 w-36"></div>
        </div>
        <div class="flex flex-col gap-4 px-4 py-4 md:px-5 md:py-5">
          <div aria-hidden="true" class="${PULSE} h-3.5 w-16"></div>
          <div aria-hidden="true" class="${PULSE} h-9 w-full"></div>
          <div aria-hidden="true" class="${PULSE} h-3.5 w-16"></div>
          <div aria-hidden="true" class="${PULSE} h-9 w-full"></div>
        </div>
      </div>
    </div>
  `,
})
export class LeagueLoading {
  protected readonly rows = [1, 2, 3];
}
