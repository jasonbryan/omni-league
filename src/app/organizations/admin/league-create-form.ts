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
import {
  lucideCheck,
  lucideCircleAlert,
  lucideLoaderCircle,
  lucidePlus,
  lucideSparkles,
} from '@ng-icons/lucide';
import type { Id } from '../../../../convex/_generated/dataModel';
import { SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { api, injectMutation, injectOnline } from '../../core/data/convex';
import { Checkbox } from '../../ui/checkbox';
import { leaguePath } from '../league/league-path';
import { AdminAlert } from './admin-alert';
import { AdminOfflineAlert } from './admin-offline-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { CREATED_STATUS, CREATED_TITLE } from './footer-status';
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
} from './field-classes';
import { STICKY_FOOTER_CLEARANCE, StickyFooter } from './sticky-footer';
import { StickyFooterFocus } from './sticky-footer-focus';
import { filledFromNameMessage } from './league-division';
import { LeagueDivisionFields } from './league-division-fields';
import { LEAGUE_FORM_ALERTS, LeagueForm, type LeagueField } from './league-form';

export interface LeagueLocationChoice {
  locationId: Id<'locations'>;
  name: string;
}

@Component({
  selector: 'app-league-create-form',
  imports: [
    AdminAlert,
    AdminOfflineAlert,
    Checkbox,
    ChipRadioGroup,
    FormField,
    LeagueDivisionFields,
    NgIcon,
    RouterLink,
    StickyFooter,
    StickyFooterFocus,
  ],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleAlert,
      lucideLoaderCircle,
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
      <div data-slot="field-group" [class]="fieldGroupClass + ' ' + clearanceClass">
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
            (blur)="form.left('name')"
            (input)="nameTyped($event)"
            [attr.aria-describedby]="describedBy('name', 'name-description')"
            [attr.aria-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-invalid]="form.errors.name() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="form.errors.name() ? 'true' : null"
            [class]="inputClass"
          />
          <p data-slot="field-description" id="name-description" [class]="descriptionClass">
            The name players know it by every season, such as Sunday Coed 4s. Up to 100 characters.
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
            (blur)="form.left('slug')"
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
          id="locations"
          data-slot="field-set"
          [attr.aria-describedby]="
            form.errors.locations()
              ? 'locations-description locations-error'
              : 'locations-description'
          "
          [attr.data-invalid]="form.errors.locations() ? 'true' : null"
          (focusout)="form.leftGroup('locations', $event)"
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
                  (checkedChange)="toggleLocation(location.locationId, $event)"
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
          (mousedown)="keepFocusOnPress($event)"
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
  protected readonly form = new LeagueForm(() => this.locations().map((l) => l.locationId));
  protected readonly alerts = LEAGUE_FORM_ALERTS;
  protected readonly sports: readonly ChipOption[] = (Object.keys(SPORT_NAMES) as Sport[]).map(
    (key) => ({ key, label: SPORT_NAMES[key] }),
  );

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

  // The error that leaving a field shows can push this button down before the release, losing the click.
  protected keepFocusOnPress(event: MouseEvent): void {
    event.preventDefault();
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
