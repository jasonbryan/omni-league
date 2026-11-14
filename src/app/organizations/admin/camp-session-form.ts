import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircleAlert, lucidePlus } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import {
  CAMP_SESSION_FORM_ALERTS,
  CampSessionFormState,
  type CampSessionField,
} from './camp-session-form-state';
import { CREATED_STATUS, CREATED_TITLE } from './footer-status';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';

interface Entry {
  field: CampSessionField;
  id: string;
  label: string;
  description: string;
}

const DATES: readonly Entry[] = [
  { field: 'startDate', id: 'start-date', label: 'Start date', description: '' },
  { field: 'endDate', id: 'end-date', label: 'End date', description: '' },
  {
    field: 'registrationDeadline',
    id: 'registration-deadline',
    label: 'Registration deadline',
    description: 'On or before the start date.',
  },
];

const TIMES: readonly Entry[] = [
  {
    field: 'dailyStartTime',
    id: 'daily-start-time',
    label: 'Daily start time',
    description: 'Optional. Shown as entered, with no time zone.',
  },
  {
    field: 'dailyEndTime',
    id: 'daily-end-time',
    label: 'Daily end time',
    description: 'Optional. Enter both times or neither.',
  },
];

const FOCUS_SELECTOR: Record<CampSessionField, string> = {
  name: '#name',
  startDate: '#start-date',
  endDate: '#end-date',
  registrationDeadline: '#registration-deadline',
  dailyStartTime: '#daily-start-time',
  dailyEndTime: '#daily-end-time',
  places: '#places',
};

@Component({
  selector: 'app-camp-session-form',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
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
  providers: [provideIcons({ lucideCheck, lucideCircleAlert, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      appStickyFooterFocus
      novalidate
      aria-labelledby="add-session-heading"
      class="px-4 py-4 md:px-5 md:py-5"
      (submit)="submit($event)"
      (input)="edited()"
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
      <div hlmFieldGroup [class]="clearanceClass">
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          [attr.data-invalid]="form.errors.name() ? 'true' : null"
        >
          <label hlmFieldLabel for="name">Name</label>
          <input
            hlmInput
            id="name"
            type="text"
            autocomplete="off"
            [formField]="form.fields.name"
            (blur)="form.left('name')"
            [attr.aria-describedby]="describedBy('name', 'name')"
            [attr.aria-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          />
          <p hlmFieldDescription id="name-description">For example Week 1. Up to 100 characters.</p>
          @if (form.errors.name(); as error) {
            <div hlmFieldError id="name-error">
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
          @for (date of dates; track date.field) {
            <div
              hlmField
              [class.sm:col-span-2]="date.field === 'registrationDeadline'"
              [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
            >
              <label hlmFieldLabel [for]="date.id">{{ date.label }}</label>
              <input
                hlmInput
                [id]="date.id"
                type="date"
                autocomplete="off"
                [formField]="form.fields[date.field]"
                (blur)="form.left(date.field)"
                [attr.aria-describedby]="describedBy(date.field, date.id, date.description !== '')"
                [attr.aria-invalid]="form.errors[date.field]() ? 'true' : null"
                [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              />
              @if (date.description) {
                <p hlmFieldDescription [id]="date.id + '-description'">{{ date.description }}</p>
              }
              @if (form.errors[date.field](); as error) {
                <div hlmFieldError [id]="date.id + '-error'">
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
          [attr.data-matches-spartan-invalid]="form.errors.places() ? 'true' : null"
          [attr.data-invalid]="form.errors.places() ? 'true' : null"
        >
          <label hlmFieldLabel for="places">Places</label>
          <input
            hlmInput
            id="places"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [formField]="form.fields.places"
            (blur)="form.left('places')"
            [attr.aria-describedby]="describedBy('places', 'places')"
            [attr.aria-invalid]="form.errors.places() ? 'true' : null"
            [attr.data-invalid]="form.errors.places() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.places() ? 'true' : null"
          />
          <p hlmFieldDescription id="places-description">From 1 to 500.</p>
          @if (form.errors.places(); as error) {
            <div hlmFieldError id="places-error">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
      </div>
      <div appStickyFooter>
        <div role="status" data-slot="added-status">
          @if (added()) {
            <div [class]="addedClass">
              <ng-icon name="lucideCheck" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
              <span [class]="addedTitleClass">Session added.</span>
            </div>
          }
        </div>
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
            <hlm-spinner data-icon="inline-start" />Adding session…
          } @else {
            <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Add session
          }
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Adding the session.' : '' }}</p>
    </form>
  `,
})
export class CampSessionForm {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly add = injectMutation(api.campSessions.add);

  readonly campId = input.required<Id<'camps'>>();

  protected readonly online = injectOnline();
  protected readonly form = new CampSessionFormState();
  protected readonly alerts = CAMP_SESSION_FORM_ALERTS;
  protected readonly dates = DATES;
  protected readonly times = TIMES;

  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full`;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly addedClass = CREATED_STATUS;
  protected readonly addedTitleClass = CREATED_TITLE;

  protected readonly added = signal(false);

  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected describedBy(field: CampSessionField, id: string, hasDescription = true): string | null {
    const ids = [
      hasDescription ? `${id}-description` : null,
      this.form.errors[field]() ? `${id}-error` : null,
    ];
    const described = ids.filter((part) => part !== null).join(' ');
    return described === '' ? null : described;
  }

  protected edited(): void {
    this.added.set(false);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    this.added.set(false);
    const campId = this.campId();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.add.run({ campId, ...values }),
    );
    if (outcome.sent) {
      this.added.set(true);
      this.form.clear();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  focusName(): void {
    this.focusField('name');
  }

  private focusField(field: CampSessionField): void {
    this.host.nativeElement.querySelector<HTMLElement>(FOCUS_SELECTOR[field])?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
