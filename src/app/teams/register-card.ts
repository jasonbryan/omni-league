import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft } from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../convex/lib/seasonInput';
import { seasonDates } from '../organizations/league/season-dates';
import type { RegistrationAnswer } from './register-team-state';
import { HlmCard } from '../ui/card';
import { HlmSkeleton } from '../ui/skeleton';

export function rosterRange(minimumRosterSize: number, maxRosterSize?: number): string {
  if (maxRosterSize === undefined) return `At least ${minimumRosterSize} players`;
  if (maxRosterSize === minimumRosterSize) return `${minimumRosterSize} players`;
  return `${minimumRosterSize} to ${maxRosterSize} players`;
}

@Component({
  selector: 'app-register-card',
  imports: [HlmCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
      <div class="mx-auto w-full max-w-lg">
        <a
          [routerLink]="seasonHref()"
          class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
          ><ng-icon name="lucideArrowLeft" class="text-base" aria-hidden="true" />{{ heading() }}</a
        >
        <div hlmCard size="bare" class="mt-3 overflow-hidden">
          <div class="px-5 pt-6 md:px-8 md:pt-8">
            <p class="text-sm font-medium text-muted-foreground">{{ kicker() }}</p>
            <h1
              id="register-heading"
              class="mt-1 text-2xl font-semibold tracking-tight text-balance"
            >
              {{ heading() }}
            </h1>
            <p class="mt-2 text-sm text-muted-foreground">{{ season().organizationName }}</p>
          </div>
          <dl
            class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border text-sm md:mx-8"
          >
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
              <dt class="text-muted-foreground">Dates</dt>
              <dd class="font-medium sm:text-end">{{ dates() }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
              <dt class="text-muted-foreground">Format</dt>
              <dd class="font-medium sm:text-end">{{ season().formatName }}</dd>
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
export class RegisterCard {
  readonly season = input.required<NonNullable<RegistrationAnswer>>();
  readonly kicker = input.required<string>();
  readonly seasonHref = input.required<string>();

  protected readonly heading = computed(
    () => `${this.season().leagueName}, ${this.season().seasonName}`,
  );
  protected readonly dates = computed(() =>
    seasonDates(this.season().startDate, this.season().endDate),
  );
  protected readonly roster = computed(() =>
    rosterRange(this.season().minimumRosterSize, this.season().maxRosterSize),
  );
  protected readonly deadline = computed(() =>
    formatCalendarDate(this.season().registrationDeadline),
  );
}

@Component({
  selector: 'app-register-skeleton',
  imports: [HlmCard, HlmSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
      <div data-testid="register-skeleton" class="mx-auto w-full max-w-lg">
        <p role="status" class="sr-only">Loading the season.</p>
        <div aria-hidden="true" class="flex h-5 items-center pointer-coarse:h-11">
          <div hlmSkeleton class="rounded-md h-4 w-56"></div>
        </div>
        <div aria-hidden="true" hlmCard size="bare" class="mt-3 overflow-hidden">
          <div class="px-5 pt-6 md:px-8 md:pt-8">
            <div hlmSkeleton class="rounded-md h-5 w-28"></div>
            <div hlmSkeleton class="rounded-md mt-1 h-8 w-72 max-w-full"></div>
            <div hlmSkeleton class="rounded-md mt-2 h-5 w-44"></div>
          </div>
          <div class="mx-5 mt-5 divide-y divide-border rounded-lg border border-border md:mx-8">
            @for (row of rows; track row) {
              <div class="flex justify-between gap-x-4 px-3 py-2.5">
                <div hlmSkeleton class="rounded-md h-5 w-24"></div>
                <div hlmSkeleton class="rounded-md h-5 w-32"></div>
              </div>
            }
          </div>
          <div class="px-5 pt-5 pb-6 md:px-8 md:pb-8">
            <div hlmSkeleton class="rounded-md h-5 w-full"></div>
            @if (withNameField()) {
              <div hlmSkeleton class="rounded-md mt-5 h-9 w-full"></div>
            }
            <div hlmSkeleton class="mt-6 h-9 w-full rounded-lg"></div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class RegisterSkeleton {
  readonly withNameField = input(false);

  protected readonly rows = [0, 1, 2, 3];
}
