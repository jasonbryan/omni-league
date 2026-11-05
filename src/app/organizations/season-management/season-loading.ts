import { ChangeDetectionStrategy, Component } from '@angular/core';

const PULSE = 'rounded-md bg-muted motion-safe:animate-pulse';
const CARD = 'rounded-xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10';
const PANEL = `overflow-hidden ${CARD}`;

@Component({
  selector: 'app-season-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8' },
  template: `
    <p role="status" class="sr-only">Loading the season.</p>
    <div aria-hidden="true" class="${PULSE} h-4 w-56 max-w-full"></div>
    <div aria-hidden="true" class="${PULSE} mt-3 h-8 w-44"></div>
    <div aria-hidden="true" class="${PULSE} mt-3 h-5 w-64 max-w-full"></div>
    <div class="mt-6 grid grid-cols-2 gap-3 md:gap-4">
      @for (tile of tiles; track tile) {
        <div aria-hidden="true" class="${CARD} px-3 py-3 md:px-4 md:py-4">
          <div aria-hidden="true" class="${PULSE} h-3.5 w-16"></div>
          <div aria-hidden="true" class="${PULSE} mt-2 h-7 w-8"></div>
        </div>
      }
    </div>
    <div class="mt-4 grid items-start gap-4 md:mt-6 md:gap-6 lg:grid-cols-3">
      <div aria-hidden="true" class="${PANEL} lg:col-span-2">
        <div class="border-b border-border px-4 py-3 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-5 w-20"></div>
        </div>
        <div class="divide-y divide-border">
          @for (row of teamRows; track row) {
            <div class="flex gap-3 px-4 py-3.5 md:px-5">
              <div class="flex-1">
                <div aria-hidden="true" class="${PULSE} h-4 w-40 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-48 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-32 max-w-full"></div>
              </div>
            </div>
          }
        </div>
      </div>
      <div aria-hidden="true" class="${PANEL}">
        <div class="border-b border-border px-4 py-3 md:px-5">
          <div aria-hidden="true" class="${PULSE} h-5 w-28"></div>
        </div>
        <div class="divide-y divide-border">
          @for (row of freeAgentRows; track row) {
            <div class="flex gap-3 px-4 py-3.5 md:px-5">
              <div class="flex-1">
                <div aria-hidden="true" class="${PULSE} h-4 w-40 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-48 max-w-full"></div>
                <div aria-hidden="true" class="${PULSE} mt-2 h-3.5 w-32 max-w-full"></div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class SeasonLoading {
  protected readonly tiles = [1, 2];
  protected readonly teamRows = [1, 2, 3];
  protected readonly freeAgentRows = [1, 2];
}
