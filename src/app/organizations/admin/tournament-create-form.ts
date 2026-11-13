import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideCircleAlert,
  lucideCopy,
  lucidePlus,
  lucideSparkles,
} from '@ng-icons/lucide';
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
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { CREATED_STATUS, CREATED_TITLE } from './footer-status';
import { filledFromNameMessage } from './league-division';
import { LeagueDivisionFields, type DivisionErrors } from './league-division-fields';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import { tournamentPath } from './tournament-path';
import {
  TOURNAMENT_FORM_ALERTS,
  TournamentForm,
  type TournamentCopy,
  type TournamentField,
} from './tournament-form';
import { WebAddressStatus } from './web-address-status';

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
    description: 'Leave it blank for a one-day tournament.',
  },
  {
    field: 'registrationDeadline',
    id: 'registration-deadline',
    label: 'Registration deadline',
    description:
      'Teams can register until the end of this day. It must be on or before the start date.',
  },
] as const;

const FOCUS_SELECTOR: Record<
  'startDate' | 'endDate' | 'registrationDeadline' | 'maximumTeams',
  string
> = {
  startDate: '#start-date',
  endDate: '#end-date',
  registrationDeadline: '#registration-deadline',
  maximumTeams: '#maximum-teams',
};

@Component({
  selector: 'app-tournament-create-form',
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
    LeagueDivisionFields,
    NgIcon,
    RouterLink,
    StickyFooter,
    StickyFooterFocus,
    WebAddressStatus,
  ],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleAlert,
      lucideCopy,
      lucidePlus,
      lucideSparkles,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form
      appStickyFooterFocus
      novalidate
      aria-labelledby="create-tournament-heading"
      aria-describedby="create-tournament-note"
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
      <p id="create-tournament-note" class="mb-5 text-sm text-muted-foreground">
        New tournaments start as drafts, which only your staff see.
      </p>
      @if (copiedFrom(); as source) {
        <p
          data-slot="copy-note"
          class="mb-5 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground"
        >
          <ng-icon name="lucideCopy" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
          <span
            >Copied from {{ source }}. Enter the dates and the registration deadline. Teams, the
            bracket, and results are not copied.</span
          >
        </p>
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
            The name players know it by, such as Winter Doubles Classic. Up to 100 characters.
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
            {{ organizationName() }}, across its leagues and tournaments.
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
          description="The division options below are this sport’s."
          [error]="form.errors.sport()"
          (chosen)="chooseSport($event)"
        />
        <fieldset data-slot="field-set" class="border-t border-border pt-5">
          <legend class="float-start w-full text-base font-semibold">Division</legend>
          <p class="clear-both pt-1 text-sm text-muted-foreground">
            These tell players who the tournament is for.
          </p>
          <div role="status">
            @if (filledMessage(); as message) {
              <p
                class="mt-3 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground"
              >
                <ng-icon
                  name="lucideSparkles"
                  class="mt-0.5 shrink-0 text-base"
                  aria-hidden="true"
                />
                <span>{{ message }}</span>
              </p>
            }
          </div>
          @if (form.sport(); as sport) {
            <app-league-division-fields
              class="mt-5"
              program="tournament"
              [division]="form.division"
              [sport]="sport"
              [organizationId]="organizationId()"
              [errors]="divisionErrors"
              formatDescription="Players on each side. It sets the minimum roster size of the tournament."
            />
          } @else {
            <p class="mt-3 text-sm text-muted-foreground">
              Choose a sport to see its formats and levels.
            </p>
          }
        </fieldset>
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
        <div class="grid gap-6 sm:max-lg:grid-cols-2">
          @for (date of dateFields; track date.field) {
            <div
              hlmField
              [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
              [class]="date.field === 'registrationDeadline' ? 'sm:max-lg:col-span-2' : ''"
            >
              <label hlmFieldLabel [for]="date.id">{{ date.label }}</label>
              <input
                hlmInput
                [id]="date.id"
                type="date"
                autocomplete="off"
                [formField]="form.fields[date.field]"
                (blur)="form.left(date.field)"
                [attr.aria-describedby]="
                  describedBy(
                    date.field,
                    date.description ? date.id + '-description' : null,
                    date.id
                  )
                "
                [attr.aria-invalid]="form.errors[date.field]() ? 'true' : null"
                [attr.data-invalid]="form.errors[date.field]() ? 'true' : null"
                [attr.data-matches-spartan-invalid]="form.errors[date.field]() ? 'true' : null"
              />
              @if (date.description) {
                <p hlmFieldDescription [id]="date.id + '-description'">
                  {{ date.description }}
                </p>
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
        <div
          hlmField
          [attr.data-matches-spartan-invalid]="form.errors.maximumTeams() ? 'true' : null"
          [attr.data-invalid]="form.errors.maximumTeams() ? 'true' : null"
        >
          <label hlmFieldLabel for="maximum-teams">Maximum teams</label>
          <input
            hlmInput
            id="maximum-teams"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            [formField]="form.fields.maximumTeams"
            (blur)="form.left('maximumTeams')"
            [attr.aria-describedby]="
              describedBy('maximumTeams', 'maximum-teams-description', 'maximum-teams')
            "
            [attr.aria-invalid]="form.errors.maximumTeams() ? 'true' : null"
            [attr.data-invalid]="form.errors.maximumTeams() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.maximumTeams() ? 'true' : null"
          />
          <p hlmFieldDescription id="maximum-teams-description">
            The most teams the bracket takes, from 2 to 128.
          </p>
          @if (form.errors.maximumTeams(); as error) {
            <div hlmFieldError id="maximum-teams-error">
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
        <div role="status" data-slot="created-status">
          @if (created(); as created) {
            <div [class]="createdClass">
              <ng-icon name="lucideCheck" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
              <div class="flex min-w-0 flex-wrap items-center gap-x-3">
                <span
                  data-slot="created-title"
                  [class]="createdTitleClass"
                  style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere"
                  >{{ created.name }} created. It stays a draft until you publish it.</span
                >
                <a
                  [routerLink]="openHref(created.slug)"
                  class="inline-flex items-center font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                  >Open {{ created.name }}</a
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
            <hlm-spinner data-icon="inline-start" />Creating tournament…
          } @else {
            <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create draft
            tournament
          }
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Creating the tournament.' : '' }}</p>
    </form>
  `,
})
export class TournamentCreateForm {
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly create = injectMutation(api.tournaments.create);

  readonly organizationId = input.required<Id<'organizations'>>();
  readonly organizationName = input.required<string>();
  readonly organizationSlug = input.required<string>();
  readonly locations = input.required<readonly { locationId: Id<'locations'>; name: string }[]>();
  /** Read once, so a later answer of the source never undoes what the user typed. */
  readonly copy = input<TournamentCopy | null>(null);

  protected readonly online = injectOnline();
  private readonly webAddress = injectSlugAvailability({
    query: api.tournaments.isSlugAvailable,
    slug: (): string => this.form.model().slug,
    scope: () => ({ organizationId: this.organizationId() }),
  });
  protected readonly form = new TournamentForm(
    () => this.locations().map((l) => l.locationId),
    this.webAddress,
  );
  protected readonly alerts = TOURNAMENT_FORM_ALERTS;
  protected readonly dateFields = DATE_FIELDS;
  protected readonly sports: readonly ChipOption[] = (Object.keys(SPORT_NAMES) as Sport[]).map(
    (key) => ({ key, label: SPORT_NAMES[key] }),
  );
  protected readonly divisionErrors: DivisionErrors = {
    format: () => this.form.errors.format(),
    minimumRosterSize: () => null,
    level: () => this.form.errors.level(),
    ageGroup: () => this.form.errors.ageGroup(),
  };

  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full`;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly createdClass = CREATED_STATUS;
  protected readonly createdTitleClass = CREATED_TITLE;

  protected readonly created = signal<{ name: string; slug: string } | null>(null);

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly slugInput = viewChild.required<ElementRef<HTMLInputElement>>('slug');
  private readonly sportGroup = viewChild<ChipRadioGroup>('sportGroup');
  private readonly divisionFields = viewChild(LeagueDivisionFields);
  private readonly locationBoxes = viewChildren(Checkbox);
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected readonly copiedFrom = signal<string | null>(null);
  private copyLoaded = false;

  protected readonly filledMessage = computed(() =>
    filledFromNameMessage(this.form.division.filledFromName()),
  );

  constructor() {
    effect(() => {
      const copy = this.copy();
      if (copy === null || this.copyLoaded) return;
      this.copyLoaded = true;
      untracked(() => {
        this.form.loadCopy(copy);
        this.copiedFrom.set(copy.name);
      });
    });
  }

  protected chooseSport(key: string): void {
    const sport = (Object.keys(SPORT_NAMES) as Sport[]).find((candidate) => candidate === key);
    if (!sport) return;
    this.divisionFields()?.closeCustomLevelPanel();
    this.form.chooseSport(sport);
  }

  protected describedBy(
    field: TournamentField,
    description: string | null,
    errorId: string = field,
  ): string | null {
    const ids = [description, this.form.errors[field]() ? `${errorId}-error` : null];
    const described = ids.filter((id): id is string => id !== null).join(' ');
    return described === '' ? null : described;
  }

  protected openHref(slug: string): string {
    return tournamentPath(this.organizationSlug(), slug);
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
      this.created.set({ name: outcome.values.name, slug: outcome.values.slug });
      this.copiedFrom.set(null);
      this.form.clear();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusField(field: TournamentField): void {
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
      case 'format':
      case 'level':
      case 'ageGroup':
        this.divisionFields()?.focus(field);
        break;
      default:
        this.host.nativeElement.querySelector<HTMLElement>(FOCUS_SELECTOR[field])?.focus();
    }
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
