import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClock } from '@ng-icons/lucide';
import { HlmBadge } from '../ui/badge';
import { HlmCardImports } from '../ui/card';
import type { HomeProgramCard } from './home-program-cards';

@Component({
  selector: 'app-home-programs',
  imports: [HlmBadge, HlmCardImports, NgIcon, RouterLink],
  providers: [provideIcons({ lucideClock })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mt-8 md:mt-10' },
  template: `
    <section aria-labelledby="programs-heading">
      <h2 id="programs-heading" class="text-lg font-semibold tracking-tight">Camps and training</h2>
      <ul role="list" class="mt-4 grid gap-4 md:grid-cols-2">
        @for (card of cards(); track card.key) {
          <li hlmCard>
            <div hlmCardHeader>
              <h3 hlmCardTitle class="min-w-0">
                <a
                  [routerLink]="card.path"
                  class="inline-flex items-center rounded-md wrap-anywhere text-lg font-semibold tracking-tight pointer-coarse:min-h-11 hover:underline"
                  >{{ card.title }}</a
                >
              </h3>
              <p hlmCardDescription class="min-w-0 wrap-anywhere">{{ card.detail }}</p>
            </div>
            <div hlmCardContent class="flex flex-col gap-3">
              @if (card.waitlist) {
                <span hlmBadge variant="muted">
                  <ng-icon name="lucideClock" data-icon="inline-start" aria-hidden="true" />
                  {{ card.waitlist }}</span
                >
              }
              <dl class="grid gap-3 text-sm sm:grid-cols-2">
                <div class="min-w-0">
                  <dt class="text-muted-foreground">{{ card.whenLabel }}</dt>
                  <dd class="mt-0.5 font-medium wrap-anywhere">
                    {{ card.when }}
                    @if (card.times) {
                      <span class="block font-normal text-muted-foreground">{{ card.times }}</span>
                    }
                  </dd>
                </div>
                @if (card.where) {
                  <div class="min-w-0">
                    <dt class="text-muted-foreground">Where</dt>
                    <dd class="mt-0.5 font-medium wrap-anywhere">{{ card.where }}</dd>
                  </div>
                }
                <div class="min-w-0">
                  <dt class="text-muted-foreground">Attending</dt>
                  <dd class="mt-0.5 font-medium wrap-anywhere">{{ card.who }}</dd>
                </div>
              </dl>
            </div>
          </li>
        }
      </ul>
    </section>
  `,
})
export class HomePrograms {
  readonly cards = input.required<readonly HomeProgramCard[]>();
}
