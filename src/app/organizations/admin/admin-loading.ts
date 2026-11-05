import { ChangeDetectionStrategy, Component } from '@angular/core';

const PULSE = 'rounded-md bg-muted motion-safe:animate-pulse';

@Component({
  selector: 'app-admin-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <p role="status" class="sr-only">Loading the admin area.</p>
    <div aria-hidden="true" class="${PULSE} h-4 w-40"></div>
    <div aria-hidden="true" class="${PULSE} mt-3 h-8 w-56"></div>
    <div class="mt-6 grid items-start gap-4 md:gap-6 lg:grid-cols-3">
      <div
        aria-hidden="true"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10 lg:col-span-2"
      >
        <div class="border-b border-border px-4 py-3 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-5 w-24"></div>
        </div>
        <div class="divide-y divide-border">
          @for (row of rows; track row) {
            <div class="flex gap-3 px-4 py-3.5 md:px-5">
              <div aria-hidden="true" class="${PULSE} size-9 shrink-0 rounded-lg"></div>
              <div class="flex-1">
                <div aria-hidden="true" class="${PULSE} h-4 w-48 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-64 max-w-full"></div>
              </div>
            </div>
          }
        </div>
      </div>
      <div
        aria-hidden="true"
        class="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10"
      >
        <div class="border-b border-border px-4 py-3 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-5 w-32"></div>
        </div>
        <div class="flex flex-col gap-4 px-4 py-4 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-9"></div>
          <div aria-hidden="true" class="${PULSE} h-9"></div>
          <div aria-hidden="true" class="${PULSE} h-9 w-32"></div>
        </div>
      </div>
    </div>
  `,
})
export class AdminLoading {
  protected readonly rows = [1, 2, 3];
}
