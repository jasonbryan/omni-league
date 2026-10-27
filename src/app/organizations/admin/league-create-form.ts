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
  lucideCircleAlert,
  lucideLoaderCircle,
  lucidePlus,
  lucideSparkles,
} from '@ng-icons/lucide';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  AGE_GROUPS,
  GENDERS,
  formatLabel,
  genderLabel,
  isYouth,
  levelLabel,
  levelsOfSport,
  playersPerSideOfSport,
} from '../../../../convex/lib/divisions';
import { ROSTER_SIZE_INPUT_MAX, SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { injectMutation, injectOnline, injectQuery, skipToken } from '../../core/data/convex';
import { Checkbox } from '../../ui/checkbox';
import { leaguePath } from '../league/league-path';
import { AdminAlert } from './admin-alert';
import { PRIMARY_BUTTON } from './button-classes';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { CustomLevelPanel, type AddedCustomLevel } from './custom-level-panel';
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
import { STICKY_FOOTER, STICKY_FOOTER_CLEARANCE } from './sticky-footer';
import { filledFromNameMessage } from './league-division';
import { LEAGUE_FORM_ALERTS, LeagueForm, type LeagueField } from './league-form';

const CUSTOM_KEY_PREFIX = 'custom:';

export interface LeagueLocationChoice {
  locationId: Id<'locations'>;
  name: string;
}

@Component({
  selector: 'app-league-create-form',
  imports: [AdminAlert, Checkbox, ChipRadioGroup, CustomLevelPanel, FormField, NgIcon, RouterLink],
  providers: [provideIcons({ lucideCircleAlert, lucideLoaderCircle, lucidePlus, lucideSparkles })],
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
      @if (created(); as created) {
        <app-admin-alert
          kind="success"
          [title]="created.name + ' created as a draft.'"
          description="Publish it when it’s ready for players to see."
          class="mb-5"
          ><a [routerLink]="leaguePath(created.slug)">Add seasons to {{ created.name }}</a>
        </app-admin-alert>
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
            <div class="mt-5 flex flex-col gap-6">
              <app-chip-radio-group
                name="gender"
                legend="Gender"
                [options]="genders"
                [value]="form.division.gender()"
                description="Shown as Boys and Girls for youth age groups."
                (chosen)="chooseGender($event)"
              />
              <div>
                <app-chip-radio-group
                  #formatGroup
                  name="format"
                  legend="Format"
                  [options]="formatOptions()"
                  [value]="chosenFormat()"
                  description="Players on each side. It sets the minimum roster size of every season of this league."
                  [error]="form.errors.format()"
                  (chosen)="chooseFormat($event)"
                />
                @if (minimumShown()) {
                  <div
                    role="group"
                    data-slot="field"
                    data-orientation="vertical"
                    [attr.data-matches-spartan-invalid]="
                      form.errors.minimumRosterSize() ? 'true' : null
                    "
                    [class]="fieldClass + ' mt-4'"
                  >
                    <label for="minimum-roster-size" data-slot="field-label" [class]="labelClass"
                      >Minimum roster size</label
                    >
                    <input
                      #minimum
                      id="minimum-roster-size"
                      type="number"
                      inputmode="numeric"
                      data-slot="input"
                      autocomplete="off"
                      [value]="form.division.minimumText()"
                      (input)="minimumTyped($event)"
                      (blur)="form.left('minimumRosterSize')"
                      [attr.aria-describedby]="
                        form.errors.minimumRosterSize()
                          ? 'minimum-roster-size-description minimum-roster-size-error'
                          : 'minimum-roster-size-description'
                      "
                      [attr.aria-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
                      [attr.data-invalid]="form.errors.minimumRosterSize() ? 'true' : null"
                      [attr.data-matches-spartan-invalid]="
                        form.errors.minimumRosterSize() ? 'true' : null
                      "
                      [class]="inputClass"
                    />
                    <p
                      data-slot="field-description"
                      id="minimum-roster-size-description"
                      [class]="descriptionClass"
                    >
                      Leave it blank to use the format’s own. Up to {{ rosterSizeMax }}.
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
                } @else {
                  <button
                    type="button"
                    class="mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-primary underline underline-offset-4 pointer-coarse:min-h-11"
                    (click)="openMinimum()"
                  >
                    <ng-icon name="lucidePlus" class="text-base" aria-hidden="true" />Raise the
                    minimum roster size
                  </button>
                }
              </div>
              <div>
                <app-chip-radio-group
                  #levelGroup
                  name="level"
                  legend="Level"
                  [options]="levelOptions()"
                  [value]="chosenLevel()"
                  [description]="levelDescription()"
                  [error]="form.errors.level()"
                  (chosen)="chooseLevel($event)"
                />
                <app-custom-level-panel
                  [organizationId]="organizationId()"
                  [sport]="sport"
                  (added)="customLevelAdded($event)"
                  (undone)="form.division.undoCustomLevel($event)"
                />
              </div>
              <div
                role="group"
                data-slot="field"
                data-orientation="vertical"
                [attr.data-matches-spartan-invalid]="form.errors.ageGroup() ? 'true' : null"
                [class]="fieldClass"
              >
                <label for="age-group" data-slot="field-label" [class]="labelClass"
                  >Age group</label
                >
                <select
                  #ageGroup
                  id="age-group"
                  name="ageGroup"
                  data-slot="input"
                  (change)="ageGroupChosen($event)"
                  [attr.aria-describedby]="
                    form.errors.ageGroup()
                      ? 'age-group-description age-group-error'
                      : 'age-group-description'
                  "
                  [attr.aria-invalid]="form.errors.ageGroup() ? 'true' : null"
                  [attr.data-matches-spartan-invalid]="form.errors.ageGroup() ? 'true' : null"
                  [class]="inputClass"
                >
                  @for (group of ageGroups; track group.label) {
                    <optgroup [label]="group.label">
                      @for (option of group.options; track option.key) {
                        <option
                          [value]="option.key"
                          [selected]="form.division.ageGroup() === option.key"
                        >
                          {{ option.label }}
                        </option>
                      }
                    </optgroup>
                  }
                </select>
                <p
                  data-slot="field-description"
                  id="age-group-description"
                  [class]="descriptionClass"
                >
                  Adult unless the league is for an age bracket, such as 40+, or a youth group, such
                  as U10.
                </p>
                @if (form.errors.ageGroup(); as error) {
                  <div
                    role="alert"
                    data-slot="field-error"
                    id="age-group-error"
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
      <div data-slot="form-footer" [class]="footerClass">
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
  protected readonly genders: readonly ChipOption[] = GENDERS.map((key) => ({
    key,
    label: genderLabel(key),
  }));
  protected readonly ageGroups = [
    { label: 'Adult', options: AGE_GROUPS.filter((group) => !isYouth(group.key)) },
    { label: 'Youth', options: AGE_GROUPS.filter((group) => isYouth(group.key)) },
  ];
  protected readonly rosterSizeMax = ROSTER_SIZE_INPUT_MAX;

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
  protected readonly footerClass = STICKY_FOOTER;
  protected readonly clearanceClass = STICKY_FOOTER_CLEARANCE;

  protected readonly created = signal<{ name: string; slug: string } | null>(null);

  protected leaguePath(leagueSlug: string): string {
    return leaguePath(this.organizationSlug(), leagueSlug);
  }

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly slugInput = viewChild.required<ElementRef<HTMLInputElement>>('slug');
  private readonly sportGroup = viewChild<ChipRadioGroup>('sportGroup');
  private readonly formatGroup = viewChild<ChipRadioGroup>('formatGroup');
  private readonly levelGroup = viewChild<ChipRadioGroup>('levelGroup');
  private readonly customLevelPanel = viewChild(CustomLevelPanel);
  private readonly minimumInput = viewChild<ElementRef<HTMLInputElement>>('minimum');
  private readonly ageGroupSelect = viewChild<ElementRef<HTMLSelectElement>>('ageGroup');
  private readonly locationBoxes = viewChildren(Checkbox);
  private readonly failureAlert = viewChild<AdminAlert>('failureAlert');
  private readonly submitButton = viewChild.required<ElementRef<HTMLButtonElement>>('submitButton');

  protected readonly formatOptions = computed<readonly ChipOption[]>(() => {
    const sport = this.form.sport();
    return sport === null
      ? []
      : playersPerSideOfSport(sport).map((count) => ({
          key: String(count),
          label: formatLabel(count),
        }));
  });
  protected readonly chosenFormat = computed(() => {
    const count = this.form.division.playersPerSide();
    return count === null ? null : String(count);
  });
  private readonly customLevelList = injectQuery(api.customLevels.listForSport, () => {
    const sport = this.form.sport();
    return sport === null ? skipToken : { organizationId: this.organizationId(), sport };
  });
  private readonly customLevels = computed(() => this.customLevelList.value() ?? []);
  protected readonly levelOptions = computed<readonly ChipOption[]>(() => {
    const sport = this.form.sport();
    if (sport === null) return [];
    return [
      ...levelsOfSport(sport).map((key) => ({ key, label: levelLabel(key) })),
      ...this.customLevels().map(({ customLevelId, name }) => ({
        key: `${CUSTOM_KEY_PREFIX}${customLevelId}`,
        label: name,
      })),
    ];
  });
  protected readonly chosenLevel = computed(() => {
    const customLevelId = this.form.division.customLevelId();
    return customLevelId === null
      ? this.form.division.level()
      : `${CUSTOM_KEY_PREFIX}${customLevelId}`;
  });
  protected readonly levelDescription = computed(() => {
    const sport = this.form.sport();
    if (sport === null) return null;
    const standard = `Standard levels for ${this.sportLabel(sport)}.`;
    const custom = this.customLevels().map(
      ({ name, standardLevel }) => `${name} (filters as ${levelLabel(standardLevel)})`,
    );
    return custom.length === 0 ? standard : `${standard} Your custom levels: ${custom.join(', ')}.`;
  });
  protected readonly filledMessage = computed(() =>
    filledFromNameMessage(this.form.division.filledFromName()),
  );

  private readonly minimumOpened = signal(false);
  // A typed value keeps the field in view, so a hidden minimum is never sent.
  protected readonly minimumShown = computed(
    () => this.minimumOpened() || this.form.division.minimumText() !== '',
  );

  protected sportLabel(sport: Sport): string {
    return SPORT_NAMES[sport].toLowerCase();
  }

  protected chooseSport(key: string): void {
    const sport = (Object.keys(SPORT_NAMES) as Sport[]).find((candidate) => candidate === key);
    if (!sport) return;
    this.customLevelPanel()?.closeAndDiscard();
    this.form.chooseSport(sport);
  }

  protected chooseGender(key: string): void {
    const gender = GENDERS.find((candidate) => candidate === key);
    if (gender) this.form.division.chooseGender(gender);
  }

  protected chooseFormat(key: string): void {
    this.form.division.chooseFormat(Number(key));
  }

  protected chooseLevel(key: string): void {
    if (key.startsWith(CUSTOM_KEY_PREFIX)) {
      const custom = this.customLevels().find(
        ({ customLevelId }) => `${CUSTOM_KEY_PREFIX}${customLevelId}` === key,
      );
      if (custom) this.form.division.chooseCustomLevel(custom);
      return;
    }
    const sport = this.form.sport();
    const level = sport && levelsOfSport(sport).find((candidate) => candidate === key);
    if (level) this.form.division.chooseLevel(level);
  }

  protected customLevelAdded({ customLevelId, standardLevel }: AddedCustomLevel): void {
    this.form.division.chooseCustomLevel({ customLevelId, standardLevel });
  }

  protected ageGroupChosen(event: Event): void {
    const key = (event.target as HTMLSelectElement).value;
    const ageGroup = AGE_GROUPS.find((candidate) => candidate.key === key);
    if (ageGroup) this.form.division.setAgeGroup(ageGroup.key);
  }

  protected minimumTyped(event: Event): void {
    this.form.division.setMinimumText((event.target as HTMLInputElement).value);
  }

  protected openMinimum(): void {
    this.minimumOpened.set(true);
    this.focusAfterRender(() => this.minimumInput()?.nativeElement.focus());
  }

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
      this.created.set({ name: outcome.values.name, slug: outcome.values.slug });
      this.form.clear();
      this.minimumOpened.set(false);
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
      sport: () => this.sportGroup(),
      format: () => this.formatGroup(),
      minimumRosterSize: () => this.minimumInput()?.nativeElement,
      level: () => this.levelGroup(),
      ageGroup: () => this.ageGroupSelect()?.nativeElement,
      locations: () => this.locationBoxes()[0],
    } as const;
    targets[field]()?.focus();
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }
}
