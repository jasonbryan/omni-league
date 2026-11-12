import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft } from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
import { seasonDates } from '../organizations/league/season-dates';
import { HlmCard } from '../ui/card';
import { rosterRange } from './register-card';
import type { TournamentRegistrationAnswer } from './register-tournament-state';

@Component({
  selector: 'app-register-tournament-card',
  imports: [HlmCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
      <div class="mx-auto w-full max-w-lg">
        <a
          [routerLink]="tournamentHref()"
          class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
          ><ng-icon name="lucideArrowLeft" class="text-base" aria-hidden="true" />{{
            tournament().name
          }}</a
        >
        <div hlmCard size="bare" class="mt-3 overflow-hidden">
          <div class="px-5 pt-6 md:px-8 md:pt-8">
            <p class="text-sm font-medium text-muted-foreground">{{ kicker() }}</p>
            <h1
              id="register-heading"
              class="mt-1 text-2xl font-semibold tracking-tight text-balance"
            >
              {{ tournament().name }}
            </h1>
            <p class="mt-2 text-sm text-muted-foreground">{{ tournament().organizationName }}</p>
          </div>
          <dl
            class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border text-sm md:mx-8"
          >
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
              <dt class="text-muted-foreground">Dates</dt>
              <dd class="font-medium sm:text-end">{{ dates() }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
              <dt class="text-muted-foreground">Division</dt>
              <dd class="font-medium sm:text-end">{{ tournament().divisionLabel }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
              <dt class="text-muted-foreground">Roster</dt>
              <dd class="font-medium sm:text-end">{{ roster() }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
              <dt class="text-muted-foreground">Registration closes</dt>
              <dd class="font-medium sm:text-end">{{ deadline() }}</dd>
            </div>
          </dl>
          <div class="px-5 pt-5 pb-6 md:px-8 md:pb-8">
            <ng-content />
          </div>
        </div>
      </div>
    </div>
  `,
})
export class RegisterTournamentCard {
  readonly tournament = input.required<NonNullable<TournamentRegistrationAnswer>>();
  readonly kicker = input.required<string>();
  readonly tournamentHref = input.required<string>();

  protected readonly dates = computed(() =>
    seasonDates(this.tournament().startDate, this.tournament().endDate),
  );
  protected readonly roster = computed(() => rosterRange(this.tournament().minimumRosterSize));
  protected readonly deadline = computed(() =>
    formatCalendarDate(this.tournament().registrationDeadline),
  );
}
