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
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCircleAlert, lucidePlus, lucideSparkles } from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { injectSlugAvailability } from '../../core/forms/slug-availability';
import { organizationPath } from '../organization-path';
import { WebAddressPreview } from './web-address-preview';
import { WebAddressStatus } from './web-address-status';
import { Checkbox } from '../../ui/checkbox';
import { leaguePath } from '../league/league-path';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { CREATED_STATUS, CREATED_TITLE } from './footer-status';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import { filledFromNameMessage } from './league-division';
import { LeagueDivisionFields } from './league-division-fields';
import { LEAGUE_FORM_ALERTS, LeagueForm, type LeagueField } from './league-form';
import { MousePressKeepsFocus } from '../../core/forms/mouse-press-keeps-focus';
import { HlmFieldImports, HlmFieldSetImports } from '../../ui/field';
import { HlmInputImports } from '../../ui/input';
import { HlmSpinner } from '../../ui/spinner';

export interface LeagueLocationChoice {
  locationId: Id<'locations'>;
  name: string;
}

@Component({
  selector: 'app-league-create-form',
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
    WebAddressPreview,
    WebAddressStatus,
  ],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleAlert,
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
      aria-labelledby="create-league-heading"
      aria-describedby="create-league-note"
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
      <p id="create-league-note" class="mb-5 text-sm text-muted-foreground">
        New leagues start as drafts, which only your staff see.
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
            The name players know it by every season, such as Sunday Coed 4s. Up to 100 characters.
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
            {{ organizationName() }}. Its public page will be at
            <app-web-address-preview [parent]="addressParent()" [slug]="addressSlug()" />
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
            Players filter leagues by these on your public page and in Find a league.
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
              [division]="form.division"
              [sport]="sport"
              [organizationId]="organizationId()"
              [errors]="form.errors"
              formatDescription="Players on each side. It sets the minimum roster size of every season of this league."
              (minimumLeft)="form.left('minimumRosterSize')"
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
                  style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere"
                  >{{ created.name }} created as a draft.</span
                >
                <a
                  [routerLink]="leaguePath(created.slug)"
                  class="inline-flex items-center font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                  >Add the first season</a
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
            <hlm-spinner data-icon="inline-start" />Creating league…
          } @else {
            <ng-icon name="lucidePlus" data-icon="inline-start" aria-hidden="true" />Create draft
            league
          }
        </button>
      </div>
      <p role="status" class="sr-only">{{ form.submitting() ? 'Creating the league.' : '' }}</p>
    </form>
  `,
})
export class LeagueCreateForm {
  private readonly injector = inject(Injector);
  private readonly create = injectMutation(api.leagues.create);

  readonly organizationId = input.required<Id<'organizations'>>();
  readonly organizationName = input.required<string>();
  readonly organizationSlug = input.required<string>();
  readonly locations = input.required<readonly LeagueLocationChoice[]>();

  protected readonly online = injectOnline();
  private readonly webAddress = injectSlugAvailability({
    query: api.leagues.isSlugAvailable,
    slug: (): string => this.form.model().slug,
    scope: () => ({ organizationId: this.organizationId() }),
  });
  protected readonly form = new LeagueForm(
    () => this.locations().map((l) => l.locationId),
    this.webAddress,
  );
  protected readonly addressParent = computed(
    () => `${organizationPath(this.organizationSlug())}/leagues`,
  );
  protected readonly addressSlug = computed(() => this.form.model().slug || 'your-address');
  protected readonly alerts = LEAGUE_FORM_ALERTS;
  protected readonly sports: readonly ChipOption[] = (Object.keys(SPORT_NAMES) as Sport[]).map(
    (key) => ({ key, label: SPORT_NAMES[key] }),
  );

  protected readonly buttonClass = `${PRIMARY_BUTTON} w-full`;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;
  protected readonly createdClass = CREATED_STATUS;
  protected readonly createdTitleClass = CREATED_TITLE;

  protected readonly created = signal<{ name: string; slug: string } | null>(null);

  protected leaguePath(leagueSlug: string): string {
    return leaguePath(this.organizationSlug(), leagueSlug);
  }

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly slugInput = viewChild.required<ElementRef<HTMLInputElement>>('slug');
  private readonly sportGroup = viewChild<ChipRadioGroup>('sportGroup');
  private readonly divisionFields = viewChild(LeagueDivisionFields);
  private readonly locationBoxes = viewChildren(Checkbox);
  private readonly failureAlert = viewChild<AdminAlert | AdminOfflineAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected readonly filledMessage = computed(() =>
    filledFromNameMessage(this.form.division.filledFromName()),
  );

  protected chooseSport(key: string): void {
    const sport = (Object.keys(SPORT_NAMES) as Sport[]).find((candidate) => candidate === key);
    if (!sport) return;
    this.divisionFields()?.closeCustomLevelPanel();
    this.form.chooseSport(sport);
  }

  protected describedBy(field: 'name' | 'slug', description: string): string {
    return this.form.errors[field]() ? `${description} ${field}-error` : description;
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
      this.form.clear();
      this.divisionFields()?.collapseMinimum();
      this.focusAfterRender(() => this.submitButton().nativeElement.focus());
    } else if ('focus' in outcome) {
      this.focusAfterRender(() => this.focusField(outcome.focus));
    } else {
      this.focusAfterRender(() => this.failureAlert()?.focus());
    }
  }

  private focusField(field: LeagueField): void {
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
        this.divisionFields()?.focus(field);
    }
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
