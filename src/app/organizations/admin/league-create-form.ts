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
  viewChildren,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideLoaderCircle, lucidePlus } from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { injectMutation, injectOnline } from '../../core/data/convex';
import { Checkbox } from '../../ui/checkbox';
import { AdminAlert } from './admin-alert';
import { PRIMARY_BUTTON } from './button-classes';
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
} from './field-classes';
import { LEAGUE_FORM_ALERTS, LeagueForm, type LeagueField } from './league-form';

/** A location the league can be held at: the organization's own, from `locations.listForAdmin`. */
export interface LeagueLocationChoice {
  locationId: Id<'locations'>;
  name: string;
}

/**
 * The create form of the Leagues page (#66; design/mockups/66-69-organization-leagues.html states
 * 4 to 8), inside the page's `#create-league` section: Name, Slug (filled from the name until
 * edited), a Sport radio group with no default, and a Locations checkbox group (one is enough).
 * Errors show after a submit, under their field or group; focus goes to the first invalid field
 * (the first sport or location for a group), or to the form alert for a failure that is not about
 * one field. On success "<league> created as a draft." appears in a status above the fields, the
 * fields clear, and focus stays on the button; the page's live list shows the new row. Like every
 * form that calls a mutation it carries the offline refusal of design/mockups/88-offline-note.html
 * (angular.md, State and data).
 */
@Component({
  selector: 'app-league-create-form',
  imports: [AdminAlert, Checkbox, FormField, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucideLoaderCircle, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      novalidate
      aria-labelledby="create-league-heading"
      aria-describedby="create-league-note"
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
      <p id="create-league-note" class="mb-5 text-sm text-muted-foreground">
        New leagues start as drafts, which only your staff see.
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
            #name
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
            Up to 100 characters.
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
            #slug
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
            {{ organizationName() }}.
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
                  ><strong class="font-semibold">{{ taken }}</strong> is already used by another
                  league here. Choose another slug.</span
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
        <fieldset
          id="sport"
          data-slot="field-set"
          [attr.aria-describedby]="form.errors.sport() ? 'sport-error' : null"
          [attr.data-invalid]="form.errors.sport() ? 'true' : null"
          [class]="fieldSetClass"
        >
          <legend
            data-slot="field-legend"
            data-variant="label"
            [class]="legendClass + (form.errors.sport() ? ' text-destructive' : '')"
          >
            Sport
          </legend>
          <div data-slot="radio-group" class="grid gap-3">
            @for (option of sports; track option.key) {
              <div
                role="group"
                data-slot="field"
                data-orientation="horizontal"
                [attr.data-matches-spartan-invalid]="form.errors.sport() ? 'true' : null"
                [class]="fieldHorizontalClass"
              >
                <span
                  data-slot="radio-group-item"
                  [attr.data-checked]="form.sport() === option.key ? 'true' : null"
                  [class]="radioClass()"
                  ><input
                    #sportRadio
                    type="radio"
                    [id]="'sport-' + option.key"
                    name="sport"
                    [value]="option.key"
                    [checked]="form.sport() === option.key"
                    [attr.aria-invalid]="form.errors.sport() ? 'true' : null"
                    (change)="form.sport.set(option.key)"
                    [class]="radioInputClass" /><span
                    aria-hidden="true"
                    [class]="radioIndicatorClass"
                  ></span
                ></span>
                <div data-slot="field-content" [class]="contentClass">
                  <label
                    [attr.for]="'sport-' + option.key"
                    data-slot="field-label"
                    [class]="labelClass"
                    >{{ option.name }}</label
                  >
                </div>
              </div>
            }
          </div>
          @if (form.errors.sport(); as error) {
            <div role="alert" data-slot="field-error" id="sport-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </fieldset>
        <fieldset
          id="locations"
          data-slot="field-set"
          [attr.aria-describedby]="
            form.errors.locations()
              ? 'locations-description locations-error'
              : 'locations-description'
          "
          [attr.data-invalid]="form.errors.locations() ? 'true' : null"
          [class]="fieldSetClass"
        >
          <legend
            data-slot="field-legend"
            data-variant="label"
            [class]="legendClass + (form.errors.locations() ? ' text-destructive' : '')"
          >
            Locations
          </legend>
          <p
            data-slot="field-description"
            id="locations-description"
            [class]="descriptionClass + ' -mt-1.5'"
          >
            Choose one or more.
          </p>
          <div data-slot="checkbox-group" class="grid gap-3">
            @for (location of locations(); track location.locationId; let i = $index) {
              <div
                role="group"
                data-slot="field"
                data-orientation="horizontal"
                [attr.data-matches-spartan-invalid]="form.errors.locations() ? 'true' : null"
                [class]="fieldHorizontalClass"
              >
                <app-checkbox
                  [controlId]="'location-' + (i + 1)"
                  [checked]="form.selected().has(location.locationId)"
                  (checkedChange)="form.toggleLocation(location.locationId, $event)"
                  [showInvalid]="!!form.errors.locations()"
                />
                <div data-slot="field-content" [class]="contentClass">
                  <label
                    [attr.for]="'location-' + (i + 1)"
                    data-slot="field-label"
                    [class]="labelClass"
                    >{{ location.name }}</label
                  >
                </div>
              </div>
            }
          </div>
          @if (form.errors.locations(); as error) {
            <div role="alert" data-slot="field-error" id="locations-error" [class]="errorClass">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </fieldset>
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
          />Creating league…
        } @else {
          <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create draft
          league
        }
      </button>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Creating the league.' : '' }}</p>
    </form>
  `,
})
export class LeagueCreateForm {
  private readonly injector = inject(Injector);
  private readonly create = injectMutation(api.leagues.create);

  readonly organizationId = input.required<Id<'organizations'>>();
  readonly organizationName = input.required<string>();
  readonly locations = input.required<readonly LeagueLocationChoice[]>();

  protected readonly online = injectOnline();
  protected readonly form = new LeagueForm(() => this.locations().map((l) => l.locationId));
  protected readonly alerts = LEAGUE_FORM_ALERTS;
  protected readonly sports = (Object.keys(SPORT_NAMES) as Sport[]).map((key) => ({
    key,
    name: SPORT_NAMES[key],
  }));

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
    () => `${RADIO_ITEM} ${this.form.errors.sport() ? RADIO_EDGE_INVALID : RADIO_EDGE}`,
  );

  /** The league just created, for the status above the fields; cleared by the next press. */
  protected readonly created = signal<string | null>(null);

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly slugInput = viewChild.required<ElementRef<HTMLInputElement>>('slug');
  private readonly sportRadios = viewChildren<ElementRef<HTMLInputElement>>('sportRadio');
  private readonly locationBoxes = viewChildren(Checkbox);
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  /** `aria-describedby`: the field's description, then its error while one is shown. */
  protected describedBy(field: 'name' | 'slug', description: string): string {
    return this.form.errors[field]() ? `${description} ${field}-error` : description;
  }

  protected nameTyped(event: Event): void {
    // Read from the event, so the order of this handler and the form field's does not matter.
    this.form.nameTyped((event.target as HTMLInputElement).value);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.form.submitting()) return;
    this.created.set(null);
    const organizationId = this.organizationId();
    const outcome = await this.form.submit(this.online(), (values) =>
      this.create.run({ organizationId, ...values }),
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

  private focusField(field: LeagueField): void {
    const targets = {
      name: () => this.nameInput().nativeElement,
      slug: () => this.slugInput().nativeElement,
      sport: () => this.sportRadios()[0]?.nativeElement,
      locations: () => this.locationBoxes()[0],
    } as const;
    targets[field]()?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
