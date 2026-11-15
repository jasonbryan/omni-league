import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft } from '@ng-icons/lucide';
import { campSessionTimes } from '../../../../convex/lib/campSessionInput';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { HlmCard } from '../../ui/card';
import { seasonDates } from '../league/season-dates';
import type { CampRegistrationAnswer } from './register-camp-state';

/** Clips its overflow rather than hiding it, because a hidden overflow makes the card the sticky footer's scroll container. */
@Component({
  selector: 'app-register-camp-card',
  imports: [HlmCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
      <div class="mx-auto w-full max-w-lg">
        <a
          [routerLink]="campHref()"
          class="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
          ><ng-icon name="lucideArrowLeft" class="text-base" aria-hidden="true" />{{
            camp().name
          }}</a
        >
        <div hlmCard size="bare" class="mt-3 overflow-clip">
          <div class="px-4 pt-6 md:px-8 md:pt-8">
            <p class="text-sm font-medium text-muted-foreground">Register for a camp session</p>
            <h1
              id="register-heading"
              class="mt-1 text-2xl font-semibold tracking-tight text-balance"
            >
              {{ camp().name }}
            </h1>
            <p class="mt-2 text-sm text-muted-foreground">{{ camp().organizationName }}</p>
          </div>
          @if (facts().length > 0) {
            <div class="px-4 pt-5 md:px-8">
              <dl class="divide-y divide-border rounded-lg border border-border text-sm">
                @for (fact of facts(); track fact.label) {
                  <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                    <dt class="text-muted-foreground">{{ fact.label }}</dt>
                    <dd class="font-medium sm:text-end">{{ fact.value }}</dd>
                  </div>
                }
              </dl>
            </div>
          }
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class RegisterCampCard {
  readonly camp = input.required<NonNullable<CampRegistrationAnswer>>();
  readonly campHref = input.required<string>();

  protected readonly facts = computed(() => {
    const { session, minimumAge, maximumAge } = this.camp();
    if (!session) return [];
    const times = campSessionTimes(session.dailyStartTime, session.dailyEndTime);
    return [
      { label: 'Session', value: session.name },
      { label: 'Dates', value: seasonDates(session.startDate, session.endDate) },
      ...(times === null ? [] : [{ label: 'Hours', value: times }]),
      minimumAge === maximumAge
        ? { label: 'Age', value: String(minimumAge) }
        : { label: 'Ages', value: `${minimumAge} to ${maximumAge}` },
      {
        label: 'Places left',
        value:
          session.placesLeft === 0
            ? 'Full'
            : `${session.placesLeft} ${session.placesLeft === 1 ? 'place' : 'places'} left`,
      },
      {
        label: 'Registration closes',
        value: formatCalendarDate(session.registrationDeadline),
      },
    ];
  });
}
