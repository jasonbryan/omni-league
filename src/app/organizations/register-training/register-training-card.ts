import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft } from '@ng-icons/lucide';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { trainingAgesLabel } from '../../../../convex/lib/trainingInput';
import {
  trainingClassDate,
  trainingHours,
  trainingPatternText,
} from '../../../../convex/lib/trainingPattern';
import { HlmCard } from '../../ui/card';
import type { TrainingRegistrationAnswer } from './register-training-state';

/** Clips its overflow rather than hiding it, because a hidden overflow makes the card the sticky footer's scroll container. */
@Component({
  selector: 'app-register-training-card',
  imports: [HlmCard, NgIcon, RouterLink],
  providers: [provideIcons({ lucideArrowLeft })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-16">
      <div class="mx-auto w-full max-w-lg">
        <a
          [routerLink]="trainingHref()"
          class="inline-flex max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
          ><ng-icon name="lucideArrowLeft" class="shrink-0 text-base" aria-hidden="true" /><span
            class="min-w-0 wrap-anywhere"
            >{{ training().name }}</span
          ></a
        >
        <div hlmCard size="bare" class="mt-3 overflow-clip">
          <div class="px-4 pt-6 md:px-8 md:pt-8">
            <p class="text-sm font-medium text-muted-foreground">{{ kicker() }}</p>
            <h1
              id="register-heading"
              class="mt-1 text-2xl font-semibold tracking-tight text-balance wrap-anywhere"
            >
              {{ training().name }}
            </h1>
            <p class="mt-2 text-sm text-muted-foreground wrap-anywhere">
              {{ training().organizationName }}
            </p>
          </div>
          <div class="px-4 pt-5 md:px-8">
            <dl class="divide-y divide-border rounded-lg border border-border text-sm">
              @for (fact of facts(); track fact.label) {
                <div class="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-3 py-2.5">
                  <dt class="text-muted-foreground">{{ fact.label }}</dt>
                  <dd class="min-w-0 font-medium wrap-anywhere sm:text-end">{{ fact.value }}</dd>
                </div>
              }
            </dl>
          </div>
          <ng-content />
        </div>
      </div>
    </div>
  `,
})
export class RegisterTrainingCard {
  readonly training = input.required<NonNullable<TrainingRegistrationAnswer>>();
  readonly trainingHref = input.required<string>();
  readonly classAsked = input(false);

  protected readonly kicker = computed(() =>
    this.classAsked() ? 'Register for a class' : 'Register for a training series',
  );

  protected readonly facts = computed(() => {
    const { pattern, minimumAge, maximumAge, placesLeft, fullClassDate, singleClass } =
      this.training();
    const ages =
      minimumAge === undefined && maximumAge === undefined
        ? []
        : [
            minimumAge !== undefined && minimumAge === maximumAge
              ? { label: 'Age', value: String(minimumAge) }
              : { label: 'Ages', value: trainingAgesLabel(minimumAge, maximumAge) },
          ];
    if (this.classAsked()) {
      return singleClass === undefined
        ? [{ label: 'Schedule', value: trainingPatternText(pattern) }, ...ages]
        : [
            { label: 'Class', value: trainingClassDate(singleClass.date) },
            { label: 'Time', value: trainingHours(singleClass.startTime, singleClass.endTime) },
            ...ages,
            {
              label: 'Places left',
              value: `${singleClass.placesLeft} ${singleClass.placesLeft === 1 ? 'place' : 'places'} left`,
            },
            { label: 'Registration closes', value: formatCalendarDate(singleClass.date) },
          ];
    }
    return [
      { label: 'Schedule', value: trainingPatternText(pattern) },
      { label: 'First class', value: formatCalendarDate(pattern.firstDate) },
      ...ages,
      {
        label: 'Places left',
        value:
          fullClassDate === undefined
            ? `At least ${placesLeft} ${placesLeft === 1 ? 'place' : 'places'} left in every class`
            : `${trainingClassDate(fullClassDate)} is full`,
      },
      { label: 'Registration closes', value: formatCalendarDate(pattern.registrationDeadline) },
    ];
  });
}
