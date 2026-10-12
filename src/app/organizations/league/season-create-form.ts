import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideLoaderCircle, lucidePlus } from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { Sport } from '../../../../convex/lib/sports';
import { injectMutation, injectOnline } from '../../core/data/convex';
import { AdminAlert } from '../admin/admin-alert';
import { PRIMARY_BUTTON } from '../admin/button-classes';
import {
  DESCRIPTION,
  FIELD,
  FIELD_CONTENT,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_HORIZONTAL,
  FIELD_SET,
  INPUT,
  LABEL,
  LEGEND,
  RADIO_EDGE,
  RADIO_EDGE_INVALID,
  RADIO_INDICATOR,
  RADIO_INPUT,
  RADIO_ITEM,
} from '../admin/field-classes';
import { SEASON_FORM_ALERTS, SeasonForm, type SeasonField } from './season-form';

/** The three date fields, in form order: the field, its element id, and its label. */
const DATE_FIELDS = [
  {
    field: 'startDate',
    id: 'start-date',
    label: 'Start date',
    description: null,
  },
  {
    field: 'endDate',
    id: 'end-date',
    label: 'End date',
    description: 'On or after the start date.',
  },
  {
    field: 'registrationDeadline',
    id: 'registration-deadline',
    label: 'Registration deadline',
    description:
      'Teams and free agents can register until the end of this day. It must be before the start date.',
  },
] as const;

/** The element to focus for each field: its input, or the first radio of the format group. */
const FOCUS_SELECTOR: Record<SeasonField, string> = {
  name: '#name',
  slug: '#slug',
  startDate: '#start-date',
  endDate: '#end-date',
  registrationDeadline: '#registration-deadline',
  format: '#format input[type="radio"]',
  minimumRosterSize: '#minimum-roster-size',
};

/**
 * The create form of the league management page (#125; design/mockups/125-126-seasons.html states
 * 4 to 11), inside the page's `#create-season` section: Name, Slug (filled from the name until
 * edited), Start date, End date, Registration deadline (native date fields), a Format radio group
 * of the league's sport with no default, and Minimum roster size (set when a format is chosen,
 * which the organizer may raise). The limits fieldset of the mockup is #143 and #144's. Errors
 * show after a submit, under their field or group; focus goes to the first invalid field (the
 * first format for the group), or to the form alert for a failure that is not about one field. On
 * success "<season> created as a draft." appears in a status above the fields, the fields clear,
 * and focus stays on the button; the page's live list shows the new row. Like every form that
 * calls a mutation it carries the offline refusal of design/mockups/88-offline-note.html
 * (angular.md, State and data).
 */
@Component({
  selector: 'app-season-create-form',
  imports: [AdminAlert, FormField, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideLoaderCircle, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      aria-labelledby="create-season-heading"
      aria-describedby="create-season-note"
      class="px-4 py-4 md:px-5 md:py-5"
      (submit)="submit($event)"
    >
      @if (created(); as name) {
        <app-admin-alert
          kind="success"
          [title]="name + ' created as a draft.'"
          description="Publish it when it’s ready for players to see."
          class="mb-5"
        />
      }
      @if (form.alert(); as kind) {
        <app-admin-alert
          #failureAlert
          [kind]="kind === 'offline' ? 'offline' : 'error'"
          [title]="alerts[kind].title"
          [description]="alerts[kind].description"
          class="mb-5"
        />
      }
      <p id="create-season-note" class="mb-5 text-sm text-muted-foreground">
        New seasons start as drafts, which only your staff see.
      </p>
      <div data-slot="field-group" [class]="fieldGroupClass">
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          [attr.data-invalid]="form.errors.name() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="name" data-slot="field-label" [class]="labelClass">Name</label>
          <input
            id="name"
            type="text"
            data-slot="input"
            autocomplete="off"
            [formField]="form.fields.name"
            (input)="nameTyped($event)"
            [attr.aria-describedby]="describedBy('name', 'name-description')"
            [attr.aria-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="name-description" [class]="descriptionClass">
            Up to 100 characters, for example Spring 2028.
          </p>
          @if (form.errors.name(); as error) {
            <div role="alert" data-slot="field-error" id="name-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </div>
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
          [attr.data-invalid]="form.errors.slug() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="slug" data-slot="field-label" [class]="labelClass">Slug</label>
          <input
            id="slug"
            type="text"
            data-slot="input"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="none"
            [formField]="form.fields.slug"
            (input)="form.slugEdited.set(true)"
            [attr.aria-describedby]="describedBy('slug', 'slug-description')"
            [attr.aria-invalid]="form.errors.slug() ? 'true' : null"
            [attr.data-invalid]="form.errors.slug() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="slug-description" [class]="descriptionClass">
            3 to 60 lowercase letters and digits, with single hyphens between them. Unique within
            {{ leagueName() }}.
          </p>
          @if (form.errors.slug(); as error) {
            <div role="alert" data-slot="field-error" id="slug-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              @if (form.takenSlug(); as taken) {
                <span
                  ><strong class="font-semibold">{{ taken }}</strong
                  >{{ error.slice(taken.length) }}</span
                >
              } @else if (form.reservedParts(); as parts) {
                <span
                  >{{ parts.before }}<strong class="font-semibold">new</strong
                  >{{ parts.after }}</span
                >
              } @else {
                <span>{{ error }}</span>
              }
            </div>
          }
        </div>
        @for (date of dateFields; track date.field) {
          <div
            role="group"
            data-slot="field"
            data-orientation="vertical"
            [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
            [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
            [class]="fieldClass"
          >
            <label [for]="date.id" data-slot="field-label" [class]="labelClass">{{
              date.label
            }}</label>
            <input
              [id]="date.id"
              type="date"
              data-slot="input"
              autocomplete="off"
              [formField]="form.fields[date.field]"
              [attr.aria-describedby]="
                describedBy(date.field, date.description ? date.id + '-description' : null, date.id)
              "
              [attr.aria-invalid]="form.errors[date.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
              [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              [class]="inputClass"
            />
            @if (date.description) {
              <p
                data-slot="field-description"
                [id]="date.id + '-description'"
                [class]="descriptionClass"
              >
                {{ date.description }}
              </p>
            }
            @if (form.errors[date.field](); as error) {
              <div
                role="alert"
                data-slot="field-error"
                [id]="date.id + '-error'"
                [class]="errorClass"
              >
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
        <fieldset
          id="format"
          data-slot="field-set"
          [attr.aria-describedby]="form.errors.format() ? 'format-error' : null"
          [attr.data-invalid]="form.errors.format() ? 'true' : null"
          [class]="fieldSetClass"
        >
          <legend
            data-slot="field-legend"
            data-variant="label"
            [class]="legendClass + (form.errors.format() ? ' text-destructive' : '')"
          >
            Format
          </legend>
          <div data-slot="radio-group" class="grid gap-3">
            @for (option of form.formats(); track option.key) {
              <div
                role="group"
                data-slot="field"
                data-orientation="horizontal"
                [attr.data-matches-spartan-invalid]="form.errors.format() ? 'true' : null"
                [class]="fieldHorizontalClass"
              >
                <span
                  data-slot="radio-group-item"
                  [attr.data-checked]="form.format() === option.key ? 'true' : null"
                  [class]="radioClass()"
                  ><input
                    type="radio"
                    [id]="'format-' + option.key"
                    name="format"
                    [value]="option.key"
                    [checked]="form.format() === option.key"
                    [attr.aria-invalid]="form.errors.format() ? 'true' : null"
                    [attr.aria-describedby]="'format-' + option.key + '-description'"
                    (change)="form.chooseFormat(option.key)"
                    [class]="radioInputClass" /><span
                    aria-hidden="true"
                    [class]="radioIndicatorClass"
                  ></span
                ></span>
                <div data-slot="field-content" [class]="contentClass">
                  <label
                    [attr.for]="'format-' + option.key"
                    data-slot="field-label"
                    [class]="labelClass"
                    >{{ option.name }}</label
                  >
                  <p
                    data-slot="field-description"
                    [id]="'format-' + option.key + '-description'"
                    [class]="descriptionClass"
                  >
                    At least {{ option.minimumRosterSize }} players
                  </p>
                </div>
              </div>
            }
          </div>
          @if (form.errors.format(); as error) {
            <div role="alert" data-slot="field-error" id="format-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </fieldset>
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
          [attr.data-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
          [class]="fieldClass"
        >
          <label for="minimum-roster-size" data-slot="field-label" [class]="labelClass"
            >Minimum roster size</label
          >
          <input
            id="minimum-roster-size"
            type="text"
            inputmode="numeric"
            data-slot="input"
            autocomplete="off"
            [formField]="form.fields.minimumRosterSize"
            [attr.aria-describedby]="
              describedBy(
                'minimumRosterSize',
                'minimum-roster-size-description',
                'minimum-roster-size'
              )
            "
            [attr.aria-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
            [attr.data-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
            [class]="inputClass"
          />
          <p
            data-slot="field-description"
            id="minimum-roster-size-description"
            [class]="descriptionClass"
          >
            {{ form.minimumHint() }}
          </p>
          @if (form.errors.minimumRosterSize(); as error) {
            <div
              role="alert"
              data-slot="field-error"
              id="minimum-roster-size-error"
              [class]="errorClass"
            >
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
      <button
        #submitButton
        type="submit"
        data-slot="button"
        [class]="buttonClass"
        [class.opacity-50]="!online() && !form.submitting()"
        [attr.aria-disabled]="form.submitting() || !online() ? 'true' : null"
      >
        @if (form.submitting()) {
          <ng-icon
            name="lucideLoaderCircle"
            class="motion-safe:animate-spin"
            data-icon="inline-start"
            aria-hidden="true"
          />Creating season…
        } @else {
          <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create draft
          season
        }
      </button>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Creating the season.' : '' }}</p>
    </form>
  `,
})
export class SeasonCreateForm {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly create = injectMutation(api.seasons.create);

  readonly leagueId = input.required<Id<'leagues'>>();
  readonly leagueName = input.required<string>();
  readonly sport = input.required<Sport>();

  protected readonly online = injectOnline();
  protected readonly form = new SeasonForm(() => this.sport());
  protected readonly alerts = SEASON_FORM_ALERTS;
  protected readonly dateFields = DATE_FIELDS;

  protected readonly fieldGroupClass = FIELD_GROUP;
  protected readonly fieldClass = FIELD;
  protected readonly fieldHorizontalClass = FIELD_HORIZONTAL;
  protected readonly fieldSetClass = FIELD_SET;
  protected readonly legendClass = LEGEND;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;
  protected readonly contentClass = FIELD_CONTENT;
  protected readonly radioInputClass = RADIO_INPUT;
  protected readonly radioIndicatorClass = RADIO_INDICATOR;
  protected readonly buttonClass = `${PRIMARY_BUTTON} mt-6 w-full`;

  /** The class of every radio's wrapper: its edge turns red while the group shows an error. */
  protected readonly radioClass = computed(
    () => `${RADIO_ITEM} ${this.form.errors.format() ? RADIO_EDGE_INVALID : RADIO_EDGE}`,
  );

  /** The season just created, for the status above the fields; cleared by the next press. */
  protected readonly created = signal<string | null>(null);

  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  /**
   * `aria-describedby`: the field's description when it has one, then its error while one is
   * shown. `null` when neither applies (Start date has no description).
   */
  protected describedBy(
    field: SeasonField,
    description: string | null,
    errorId: string = field,
  ): string | null {
    const ids = [description, this.form.errors[field]() ? `${errorId}-error` : null];
    const described = ids.filter((id): id is string => id !== null).join(' ');
    return described === '' ? null : described;
  }

  protected nameTyped(event: Event): void {
    // Read from the event, so the order of this handler and the form field's does not matter.
    this.form.nameTyped((event.target as HTMLInputElement).value);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    this.created.set(null);
    const leagueId = this.leagueId();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.create.run({ leagueId, ...values }),
    );
    if (outcome.sent) {
      this.created.set(outcome.values.name);
      this.form.clear();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusField(field: SeasonField): void {
    this.host.nativeElement.querySelector<HTMLElement>(FOCUS_SELECTOR[field])?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
