import { ChangeDetectionStrategy, Component } from '@angular/core';

const PULSE = 'rounded-md bg-muted motion-safe:animate-pulse';

/** The shell draws the real sidebar column, and the menu button, only once there is a sidebar to show, so the placeholder sits inside `<main>` and takes the column's place. */
@Component({
  selector: 'app-admin-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full' },
  template: `
    <div class="hidden w-64 shrink-0 border-e border-sidebar-border bg-sidebar lg:block">
      <div class="flex flex-col gap-6 px-3 py-5" aria-hidden="true">
        <div class="flex items-center gap-3 px-2">
          <div aria-hidden="true" class="${PULSE} size-10 shrink-0 rounded-lg"></div>
          <div class="flex-1">
            <div aria-hidden="true" class="${PULSE} h-3.5 w-36"></div>
            <div aria-hidden="true" class="${PULSE} mt-2 h-3 w-20"></div>
          </div>
        </div>
        <div class="flex flex-col gap-2 px-2">
          <div aria-hidden="true" class="${PULSE} h-5 w-28"></div>
          <div aria-hidden="true" class="${PULSE} h-5 w-24"></div>
          <div aria-hidden="true" class="${PULSE} h-5 w-24"></div>
          <div aria-hidden="true" class="${PULSE} h-5 w-20"></div>
        </div>
      </div>
    </div>
    <div class="min-w-0 flex-1">
      <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
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
      </div>
    </div>
  `,
})
export class AdminLoading {
  protected readonly rows = [1, 2, 3];
}
