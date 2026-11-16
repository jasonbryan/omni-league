import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendarPlus, lucideCircleAlert } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  MAX_TRAINING_CLASS_PLACES,
  MAX_TRAINING_WEEKS,
  MIN_TRAINING_CLASS_PLACES,
  MIN_TRAINING_WEEKS,
  WEEKDAY_NAMES,
} from '../../../../convex/lib/trainingPattern';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { Checkbox } from '../../ui/checkbox';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import {
  TRAINING_SCHEDULE_ALERTS,
  TrainingScheduleFormState,
  type TrainingPatternField,
  type TrainingScheduleTextModel,
} from './training-schedule-form-state';

interface Entry {
  field: keyof TrainingScheduleTextModel;
  id: string;
  label: string;
  description: string;
}

const TIMES: readonly Entry[] = [
  {
    field: 'startTime',
    id: 'start-time',
    label: 'Start time',
    description: 'Shown as entered, with no time zone.',
  },
  { field: 'endTime', id: 'end-time', label: 'End time', description: 'After the start time.' },
];

// Monday first, as the week reads in a schedule.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const FOCUS_SELECTOR: Record<Exclude<TrainingPatternField, 'weekday'>, string> = {
  startTime: '#start-time',
  endTime: '#end-time',
  firstDate: '#first-date',
  weeks: '#weeks',
  placesPerClass: '#places-per-class',
  registrationDeadline: '#registration-deadline',
};

@Component({
  selector: 'app-training-schedule-form',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    Checkbox,
    ChipRadioGroup,
    FormField,
    HlmFieldImports,
    HlmFieldSetImports,
    HlmInputImports,
    HlmSpinner,
    MousePressKeepsFocus,
    NgIcon,
    StickyFooter,
    StickyFooterFocus,
  ],
  providers: [provideIcons({ lucideCalendarPlus, lucideCircleAlert })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      appStickyFooterFocus
      novalidate
      aria-labelledby="schedule-heading"
      aria-describedby="schedule-note"
      class="px-4 py-4 md:px-5 md:py-5"
      (submit)="submit($event)"
    >
      @if (form.alert(); as kind) {
        @if (kind === 'offline') {
          <app-admin-offline-alert
            #failureAlert
            [description]="alerts.offline.description"
            class="mb-5"
          />
        } @else {
          <app-admin-alert
            #failureAlert
            kind="error"
            [title]="alerts[kind].title"
            [description]="alerts[kind].description"
            class="mb-5"
          />
        }
      }
      <p id="schedule-note" class="mb-5 text-sm text-muted-foreground">
        Enter the weekly pattern once. Every class is created for you, and the classes can only be
        scheduled once.
      </p>
      <div hlmFieldGroup [class]="clearanceClass">
        <app-chip-radio-group
          #weekdayGroup
          name="weekday"
          legend="Weekday"
          [options]="weekdays"
          [value]="weekdayKey()"
          [error]="form.errors.weekday()"
          (chosen)="chooseWeekday($event)"
        />
        <div class="grid gap-6 sm:grid-cols-2">
          @for (time of times; track time.field) {
            <div
              hlmField
              [attr.data-matches-spartan-invalid]="form.errors[time.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[time.field]() ? 'true' : null"
            >
              <label hlmFieldLabel [for]="time.id">{{ time.label }}</label>
              <input
                hlmInput
                [id]="time.id"
                type="time"
                autocomplete="off"
                [formField]="form.fields[time.field]"
                (blur)="form.left(time.field)"
                [attr.aria-describedby]="describedBy(time.field, time.id)"
                [attr.aria-invalid]="form.errors[time.field]() ? 'true' : null"
                [attr.data-invalid]="form.errors[time.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.errors[time.field]() ? 'true' : null"
              />
              <p hlmFieldDescription [id]="time.id + '-description'">{{ time.description }}</p>
              @if (form.errors[time.field](); as error) {
                <div hlmFieldError [id]="time.id + '-error'">
                  <ng-icon
                    name="lucideCircleAlert"
                    class="mt-0.5 shrink-0 text-base"
                    aria-hidden="true"
                  />
                  <span>{{ error }}</span>
                </div>
              }
            </div>
          }
        </div>
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.firstDate() ? 'true' : null"
          [attr.data-invalid]="form.errors.firstDate() ? 'true' : null"
        >
          <label hlmFieldLabel for="first-date">First date</label>
          <input
            hlmInput
            id="first-date"
            type="date"
            autocomplete="off"
            [formField]="form.fields.firstDate"
            (blur)="form.left('firstDate')"
            [attr.aria-describedby]="describedBy('firstDate', 'first-date')"
            [attr.aria-invalid]="form.errors.firstDate() ? 'true' : null"
            [attr.data-invalid]="form.errors.firstDate() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.firstDate() ? 'true' : null"
          />
          <p hlmFieldDescription id="first-date-description">
            The date of the first class, on the weekday above, today or later.
          </p>
          @if (form.errors.firstDate(); as error) {
            <div hlmFieldError id="first-date-error">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
        <div class="grid gap-6 sm:grid-cols-2">
          @for (count of counts; track count.field) {
            <div
              hlmField
              [attr.data-matches-spartan-invalid]="form.errors[count.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[count.field]() ? 'true' : null"
            >
              <label hlmFieldLabel [for]="count.id">{{ count.label }}</label>
              <input
                hlmInput
                [id]="count.id"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                [formField]="form.fields[count.field]"
                (blur)="form.left(count.field)"
                [attr.aria-describedby]="describedBy(count.field, count.id)"
                [attr.aria-invalid]="form.errors[count.field]() ? 'true' : null"
                [attr.data-invalid]="form.errors[count.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.errors[count.field]() ? 'true' : null"
              />
              <p hlmFieldDescription [id]="count.id + '-description'">{{ count.description }}</p>
              @if (form.errors[count.field](); as error) {
                <div hlmFieldError [id]="count.id + '-error'">
                  <ng-icon
                    name="lucideCircleAlert"
                    class="mt-0.5 shrink-0 text-base"
                    aria-hidden="true"
                  />
                  <span>{{ error }}</span>
                </div>
              }
            </div>
          }
        </div>
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.registrationDeadline() ? 'true' : null"
          [attr.data-invalid]="form.errors.registrationDeadline() ? 'true' : null"
        >
          <label hlmFieldLabel for="registration-deadline">Series registration deadline</label>
          <input
            hlmInput
            id="registration-deadline"
            type="date"
            autocomplete="off"
            [formField]="form.fields.registrationDeadline"
            (blur)="form.left('registrationDeadline')"
            [attr.aria-describedby]="describedBy('registrationDeadline', 'registration-deadline')"
            [attr.aria-invalid]="form.errors.registrationDeadline() ? 'true' : null"
            [attr.data-invalid]="form.errors.registrationDeadline() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.registrationDeadline() ? 'true' : null"
          />
          <p hlmFieldDescription id="registration-deadline-description">
            On or before the first class.
          </p>
          @if (form.errors.registrationDeadline(); as error) {
            <div hlmFieldError id="registration-deadline-error">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
        <div hlmField orientation="horizontal">
          <app-checkbox
            controlId="allow-single"
            [checked]="form.allowSingleRegistration()"
            (checkedChange)="form.allowSingleRegistration.set($event)"
          />
          <div hlmFieldContent>
            <label hlmFieldLabel for="allow-single">Allow single-class registration</label>
            <p hlmFieldDescription>People can register for one class, not only the series.</p>
          </div>
        </div>
      </div>
      <div appStickyFooter>
        <button
          #submitButton
          type="submit"
          data-slot="button"
          appMousePressKeepsFocus
          [class]="buttonClass"
          [class.opacity-50]="!online() && !form.submitting()"
          [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
        >
          @if (form.submitting()) {
            <hlm-spinner data-icon="inline-start" />Scheduling classes…
          } @else {
            <ng-icon
              name="lucideCalendarPlus"
              data-icon="inline-start"
              aria-hidden="true"
            />Schedule classes
          }
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Scheduling the classes.' : '' }}</p>
    </form>
  `,
})
export class TrainingScheduleForm {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly schedule = injectMutation(api.trainingClasses.schedule);

  readonly trainingId = input.required<Id<'trainings'>>();
  readonly scheduled = output<number>();

  protected readonly online = injectOnline();
  protected readonly form = new TrainingScheduleFormState();
  protected readonly alerts = TRAINING_SCHEDULE_ALERTS;
  protected readonly times = TIMES;
  protected readonly counts: readonly Entry[] = [
    {
      field: 'weeks',
      id: 'weeks',
      label: 'Number of weeks',
      description: `From ${MIN_TRAINING_WEEKS} to ${MAX_TRAINING_WEEKS}.`,
    },
    {
      field: 'placesPerClass',
      id: 'places-per-class',
      label: 'Places per class',
      description: `From ${MIN_TRAINING_CLASS_PLACES} to ${MAX_TRAINING_CLASS_PLACES}.`,
    },
  ];
  protected readonly weekdays: readonly ChipOption[] = WEEKDAY_ORDER.map((day) => ({
    key: String(day),
    label: WEEKDAY_NAMES[day],
  }));
  protected readonly weekdayKey = () => {
    const weekday = this.form.weekday();
    return weekday === null ? null : String(weekday);
  };

  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full`;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;

  private readonly weekdayGroup = viewChild<ChipRadioGroup>('weekdayGroup');
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');

  protected chooseWeekday(key: string): void {
    this.form.chooseWeekday(Number(key));
  }

  protected describedBy(field: TrainingPatternField, id: string): string | null {
    const ids = [`${id}-description`, this.form.errors[field]() ? `${id}-error` : null];
    return ids.filter((part) => part !== null).join(' ');
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    const trainingId = this.trainingId();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.schedule.run({ trainingId, ...values }),
    );
    if (outcome.sent) {
      this.scheduled.emit(outcome.values.weeks);
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusField(field: TrainingPatternField): void {
    if (field === 'weekday') {
      this.weekdayGroup()?.focus();
      return;
    }
    this.host.nativeElement.querySelector<HTMLElement>(FOCUS_SELECTOR[field])?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
