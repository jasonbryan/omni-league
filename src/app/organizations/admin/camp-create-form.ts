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
  viewChildren,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircleAlert, lucidePlus } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { injectSlugAvailability } from '../../core/forms/slug-availability';
import { Checkbox } from '../../ui/checkbox';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { CAMP_FORM_ALERTS, CampForm, type CampField } from './camp-form';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { CREATED_STATUS, CREATED_TITLE } from './footer-status';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import { WebAddressStatus } from './web-address-status';

const AGE_FIELDS = [
  {
    field: 'minimumAge',
    id: 'minimum-age',
    label: 'Ages from',
    description: 'The youngest age the camp takes, from 4 to 99.',
  },
  {
    field: 'maximumAge',
    id: 'maximum-age',
    label: 'Ages to',
    description: 'The oldest age the camp takes, from 4 to 99.',
  },
] as const;

const AGE_FOCUS_SELECTOR: Record<'minimumAge' | 'maximumAge', string> = {
  minimumAge: '#minimum-age',
  maximumAge: '#maximum-age',
};

@Component({
  selector: 'app-camp-create-form',
  imports: [
    HlmSpinner,
    MousePressKeepsFocus,
    AdminAlert,
    AdminOfflineAlert,
    Checkbox,
    ChipRadioGroup,
    FormField,
    HlmFieldImports,
    HlmFieldSetImports,
    HlmInputImports,
    NgIcon,
    StickyFooter,
    StickyFooterFocus,
    WebAddressStatus,
  ],
  providers: [provideIcons({ lucideCheck, lucideCircleAlert, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      appStickyFooterFocus
      novalidate
      aria-labelledby="create-camp-heading"
      aria-describedby="create-camp-note"
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
      <p id="create-camp-note" class="mb-5 text-sm text-muted-foreground">
        New camps start as drafts, which only your staff see.
      </p>
      <div hlmFieldGroup [class]="clearanceClass">
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          [attr.data-invalid]="form.errors.name() ? 'true' : null"
        >
          <label hlmFieldLabel for="name">Name</label>
          <input
            hlmInput
            #name
            id="name"
            type="text"
            autocomplete="off"
            [formField]="form.fields.name"
            (blur)="form.left('name')"
            (input)="nameTyped($event)"
            [attr.aria-describedby]="describedBy('name', 'name-description')"
            [attr.aria-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
          />
          <p hlmFieldDescription id="name-description">
            The name players know it by, such as Junior Beach Volleyball Camp. Up to 100 characters.
          </p>
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
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
          [attr.data-invalid]="form.errors.slug() ? 'true' : null"
        >
          <label hlmFieldLabel for="slug">Web address</label>
          <input
            hlmInput
            #slug
            id="slug"
            type="text"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="none"
            [formField]="form.fields.slug"
            (blur)="form.left('slug')"
            (input)="form.slugEdited.set(true)"
            [attr.aria-describedby]="describedBy('slug', 'slug-description')"
            [attr.aria-invalid]="form.errors.slug() ? 'true' : null"
            [attr.data-invalid]="form.errors.slug() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.slug() ? 'true' : null"
          />
          <p hlmFieldDescription id="slug-description">
            3 to 60 lowercase letters and digits, with single hyphens between them. Unique within
            {{ organizationName() }}, across its leagues, tournaments, and camps.
          </p>
          <app-web-address-status
            [available]="form.slugAvailable()"
            [reserveRoom]="form.slugStatusReservesRoom()"
          />
          @if (form.errors.slug(); as error) {
            <div hlmFieldError id="slug-error">
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
        <app-chip-radio-group
          #sportGroup
          name="sport"
          legend="Sport"
          [options]="sports"
          [value]="form.sport()"
          [error]="form.errors.sport()"
          (chosen)="chooseSport($event)"
        />
        <fieldset
          hlmFieldSet
          id="locations"
          [attr.aria-describedby]="
            form.errors.locations()
              ? 'locations-description locations-error'
              : 'locations-description'
          "
          [attr.data-invalid]="form.errors.locations() ? 'true' : null"
          (focusout)="form.leftGroup('locations', $event)"
        >
          <legend hlmFieldLegend variant="label" [class.text-destructive]="form.errors.locations()">
            Locations
          </legend>
          <p hlmFieldDescription id="locations-description" class="-mt-1.5">Choose one or more.</p>
          <div data-slot="checkbox-group" class="grid gap-3">
            @for (location of locations(); track location.locationId; let i = $index) {
              <div
                hlmField
                orientation="horizontal"
                [attr.data-matches-spartan-invalid]="form.errors.locations() ? 'true' : null"
              >
                <app-checkbox
                  [controlId]="'location-' + (i + 1)"
                  [checked]="form.selected().has(location.locationId)"
                  (checkedChange)="toggleLocation(location.locationId, $event)"
                  [showInvalid]="!!form.errors.locations()"
                />
                <div hlmFieldContent>
                  <label hlmFieldLabel [attr.for]="'location-' + (i + 1)">{{
                    location.name
                  }}</label>
                </div>
              </div>
            }
          </div>
          @if (form.errors.locations(); as error) {
            <div hlmFieldError id="locations-error">
              <ng-icon
                name="lucideCircleAlert"
                class="mt-0.5 shrink-0 text-base"
                aria-hidden="true"
              />
              <span>{{ error }}</span>
            </div>
          }
        </fieldset>
        <div class="grid gap-6 sm:grid-cols-2">
          @for (age of ageFields; track age.field) {
            <div
              hlmField
              [attr.data-matches-spartan-invalid]="form.errors[age.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[age.field]() ? 'true' : null"
            >
              <label hlmFieldLabel [for]="age.id">{{ age.label }}</label>
              <input
                hlmInput
                [id]="age.id"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                [formField]="form.fields[age.field]"
                (blur)="form.left(age.field)"
                [attr.aria-describedby]="describedBy(age.field, age.id + '-description', age.id)"
                [attr.aria-invalid]="form.errors[age.field]() ? 'true' : null"
                [attr.data-invalid]="form.errors[age.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.errors[age.field]() ? 'true' : null"
              />
              <p hlmFieldDescription [id]="age.id + '-description'">{{ age.description }}</p>
              @if (form.errors[age.field](); as error) {
                <div hlmFieldError [id]="age.id + '-error'">
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
      </div>
      <div appStickyFooter>
        <div role="status" data-slot="created-status">
          @if (created(); as created) {
            <div [class]="createdClass">
              <ng-icon name="lucideCheck" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
              <div class="flex min-w-0 flex-wrap items-center gap-x-3">
                <span
                  data-slot="created-title"
                  [class]="createdTitleClass"
                  style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere"
                  >{{ created.name }} created.</span
                >
              </div>
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
            <hlm-spinner data-icon="inline-start" />Creating camp…
          } @else {
            <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create draft
            camp
          }
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Creating the camp.' : '' }}</p>
    </form>
  `,
})
export class CampCreateForm {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly create = injectMutation(api.camps.create);

  readonly organizationId = input.required<Id<'organizations'>>();
  readonly organizationName = input.required<string>();
  readonly locations = input.required<readonly { locationId: Id<'locations'>; name: string }[]>();

  protected readonly online = injectOnline();
  private readonly webAddress = injectSlugAvailability({
    query: api.camps.isSlugAvailable,
    slug: (): string => this.form.model().slug,
    scope: () => ({ organizationId: this.organizationId() }),
  });
  protected readonly form = new CampForm(
    () => this.locations().map((l) => l.locationId),
    this.webAddress,
  );
  protected readonly alerts = CAMP_FORM_ALERTS;
  protected readonly ageFields = AGE_FIELDS;
  protected readonly sports: readonly ChipOption[] = (Object.keys(SPORT_NAMES) as Sport[]).map(
    (key) => ({ key, label: SPORT_NAMES[key] }),
  );

  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full`;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly createdClass = CREATED_STATUS;
  protected readonly createdTitleClass = CREATED_TITLE;

  protected readonly created = signal<{ name: string } | null>(null);

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly slugInput = viewChild.required<ElementRef<HTMLInputElement>>('slug');
  private readonly sportGroup = viewChild<ChipRadioGroup>('sportGroup');
  private readonly locationBoxes = viewChildren(Checkbox);
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected chooseSport(key: string): void {
    const sport = (Object.keys(SPORT_NAMES) as Sport[]).find((candidate) => candidate === key);
    if (sport) this.form.chooseSport(sport);
  }

  protected describedBy(
    field: CampField,
    description: string | null,
    errorId: string = field,
  ): string | null {
    const ids = [description, this.form.errors[field]() ? `${errorId}-error` : null];
    const described = ids.filter((id): id is string => id !== null).join(' ');
    return described === '' ? null : described;
  }

  protected edited(): void {
    this.created.set(null);
  }

  protected toggleLocation(locationId: Id<'locations'>, checked: boolean): void {
    this.edited();
    this.form.toggleLocation(locationId, checked);
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
      this.created.set({ name: outcome.values.name });
      this.form.clear();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusField(field: CampField): void {
    switch (field) {
      case 'name':
        this.nameInput().nativeElement.focus();
        break;
      case 'slug':
        this.slugInput().nativeElement.focus();
        break;
      case 'sport':
        this.sportGroup()?.focus();
        break;
      case 'locations':
        this.locationBoxes()[0]?.focus();
        break;
      default:
        this.host.nativeElement.querySelector<HTMLElement>(AGE_FOCUS_SELECTOR[field])?.focus();
    }
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
