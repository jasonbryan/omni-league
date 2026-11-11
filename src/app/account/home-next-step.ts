import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUserPlus } from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
import { PRIMARY_BUTTON } from '../ui/button/button-classes';
import type { NextStep } from './next-step';

const noun = (count: number) => (count === 1 ? 'player' : 'players');

@Component({
  selector: 'app-home-next-step',
  imports: [NgIcon, RouterLink],
  providers: [provideIcons({ lucideUserPlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block mt-6 md:mt-8' },
  template: `
    <section aria-labelledby="next-heading">
      <h2 id="next-heading" class="sr-only">Next step</h2>
      <div
        class="flex flex-col gap-4 rounded-xl bg-accent p-5 text-accent-foreground sm:flex-row sm:items-center md:p-6"
      >
        <span
          class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-accent-foreground"
          ><ng-icon name="lucideUserPlus" class="text-xl" aria-hidden="true"
        /></span>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ step().teamName }} needs {{ morePlayers() }}</p>
          <p class="mt-0.5 text-sm">
            {{ step().leagueName }} needs {{ perTeam() }} per team by {{ deadline() }}.
          </p>
        </div>
        <a [routerLink]="path()" fragment="invite" data-slot="button" [class]="button"
          >Invite players<span class="sr-only"> to {{ step().teamName }}</span></a
        >
      </div>
    </section>
  `,
})
export class HomeNextStep {
  readonly step = input.required<NextStep>();

  protected readonly button = `${PRIMARY_BUTTON} w-full sm:w-auto`;
  protected readonly path = computed(() => ['/app', 'teams', this.step().teamId]);
  protected readonly morePlayers = computed(() => {
    const needed = this.step().playersNeeded;
    return `${needed} more ${noun(needed)}`;
  });
  protected readonly perTeam = computed(() => {
    const minimum = this.step().minimumRosterSize;
    return `${minimum} ${noun(minimum)}`;
  });
  protected readonly deadline = computed(() =>
    formatCalendarDate(this.step().registrationDeadline),
  );
}
