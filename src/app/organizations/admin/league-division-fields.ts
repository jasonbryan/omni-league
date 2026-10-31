import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucidePlus } from '@ng-icons/lucide';
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
  type StandardLevel,
} from '../../../../convex/lib/divisions';
import { ROSTER_SIZE_INPUT_MAX, SPORT_NAMES, type Sport } from '../../../../convex/lib/sports';
import { api, injectQuery, skipToken } from '../../core/data/convex';
import { ChipRadioGroup, type ChipOption } from './chip-radio-group';
import { CustomLevelPanel, type AddedCustomLevel } from './custom-level-panel';
import { DESCRIPTION, FIELD, FIELD_ERROR, INPUT, LABEL } from './field-classes';
import { FieldNoteText } from './field-note';
import { LeagueDivision } from './league-division';

const CUSTOM_KEY_PREFIX = 'custom:';

export type DivisionField = 'format' | 'minimumRosterSize' | 'level' | 'ageGroup';

export interface DivisionErrors {
  format: () => string | null;
  minimumRosterSize: () => string | null;
  level: () => string | null;
  ageGroup: () => string | null;
}

export interface OwnCustomLevel {
  customLevelId: Id<'customLevels'>;
  name: string;
  standardLevel: StandardLevel;
}

// Only an org admin may list or add custom levels, so a league organizer's form passes `canAddCustomLevel` false and the league's own level in `ownCustomLevel`.
@Component({
  selector: 'app-league-division-fields',
  imports: [ChipRadioGroup, CustomLevelPanel, FieldNoteText, NgIcon],
  providers: [provideIcons({ lucideCircleAlert, lucidePlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-6' },
  template: `
    <app-chip-radio-group
      [name]="ids().gender"
      legend="Gender"
      [options]="genders"
      [value]="division().gender()"
      [note]="division().notes.gender()"
      description="Shown as Boys and Girls for youth age groups."
      (chosen)="chooseGender($event)"
    />
    <div>
      <app-chip-radio-group
        #formatGroup
        [name]="ids().format"
        legend="Format"
        [options]="formatOptions()"
        [value]="chosenFormat()"
        [description]="formatDescription()"
        [note]="division().notes.format()"
        [error]="errors().format()"
        (chosen)="chooseFormat($event)"
      />
      @if (minimumShown()) {
        <div
          role="group"
          data-slot="field"
          data-orientation="vertical"
          [attr.data-matches-spartan-invalid]="errors().minimumRosterSize() ? 'true' : null"
          [class]="fieldClass + ' mt-4'"
        >
          <label [attr.for]="ids().minimum" data-slot="field-label" [class]="labelClass"
            >Minimum roster size</label
          >
          <input
            #minimum
            [id]="ids().minimum"
            type="number"
            inputmode="numeric"
            data-slot="input"
            autocomplete="off"
            [value]="division().minimumText()"
            (input)="minimumTyped($event)"
            (blur)="minimumLeft.emit()"
            [attr.aria-describedby]="
              describedBy(
                ids().minimum,
                division().notes.minimumRosterSize(),
                errors().minimumRosterSize()
              )
            "
            [attr.aria-invalid]="errors().minimumRosterSize() ? 'true' : null"
            [attr.data-invalid]="errors().minimumRosterSize() ? 'true' : null"
            [attr.data-matches-spartan-invalid]="errors().minimumRosterSize() ? 'true' : null"
            [class]="inputClass"
          />
          <p
            data-slot="field-description"
            [id]="ids().minimum + '-description'"
            [class]="descriptionClass"
          >
            Leave it blank to use the format’s own. Up to {{ rosterSizeMax }}.
          </p>
          @if (division().notes.minimumRosterSize(); as note) {
            <app-field-note [id]="ids().minimum + '-note'" [note]="note" />
          }
          @if (errors().minimumRosterSize(); as error) {
            <div
              role="alert"
              data-slot="field-error"
              [id]="ids().minimum + '-error'"
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
          <ng-icon name="lucidePlus" class="text-base" aria-hidden="true" />Raise the minimum roster
          size
        </button>
      }
    </div>
    <div>
      <app-chip-radio-group
        #levelGroup
        [name]="ids().level"
        legend="Level"
        [options]="levelOptions()"
        [value]="chosenLevel()"
        [description]="levelDescription()"
        [note]="division().notes.level()"
        [error]="errors().level()"
        (chosen)="chooseLevel($event)"
      />
      @if (canAddCustomLevel()) {
        <app-custom-level-panel
          [organizationId]="organizationId()"
          [sport]="sport()"
          (added)="customLevelAdded($event)"
          (undone)="division().undoCustomLevel($event)"
        />
      }
    </div>
    <div
      role="group"
      data-slot="field"
      data-orientation="vertical"
      [attr.data-matches-spartan-invalid]="errors().ageGroup() ? 'true' : null"
      [class]="fieldClass"
    >
      <label [attr.for]="ids().ageGroup" data-slot="field-label" [class]="labelClass"
        >Age group</label
      >
      <select
        #ageGroup
        [id]="ids().ageGroup"
        name="ageGroup"
        data-slot="input"
        (change)="ageGroupChosen($event)"
        [attr.aria-describedby]="
          describedBy(ids().ageGroup, division().notes.ageGroup(), errors().ageGroup())
        "
        [attr.aria-invalid]="errors().ageGroup() ? 'true' : null"
        [attr.data-matches-spartan-invalid]="errors().ageGroup() ? 'true' : null"
        [class]="inputClass"
      >
        @for (group of ageGroups; track group.label) {
          <optgroup [label]="group.label">
            @for (option of group.options; track option.key) {
              <option [value]="option.key" [selected]="division().ageGroup() === option.key">
                {{ option.label }}
              </option>
            }
          </optgroup>
        }
      </select>
      <p
        data-slot="field-description"
        [id]="ids().ageGroup + '-description'"
        [class]="descriptionClass"
      >
        Adult unless the league is for an age bracket, such as 40+, or a youth group, such as U10.
      </p>
      @if (division().notes.ageGroup(); as note) {
        <app-field-note [id]="ids().ageGroup + '-note'" [note]="note" />
      }
      @if (errors().ageGroup(); as error) {
        <div
          role="alert"
          data-slot="field-error"
          [id]="ids().ageGroup + '-error'"
          [class]="errorClass"
        >
          <ng-icon name="lucideCircleAlert" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
          <span>{{ error }}</span>
        </div>
      }
    </div>
  `,
})
export class LeagueDivisionFields {
  private readonly injector = inject(Injector);

  readonly division = input.required<LeagueDivision>();
  readonly sport = input.required<Sport>();
  readonly organizationId = input.required<Id<'organizations'>>();
  readonly errors = input.required<DivisionErrors>();
  readonly formatDescription = input.required<string>();
  readonly canAddCustomLevel = input(true);
  readonly ownCustomLevel = input<OwnCustomLevel | null>(null);
  /** Ids are page-wide: a page holding another form with the same fields gives this one a prefix. */
  readonly idPrefix = input('');

  readonly minimumLeft = output<void>();

  protected readonly genders: readonly ChipOption[] = GENDERS.map((key) => ({
    key,
    label: genderLabel(key),
  }));
  protected readonly ageGroups = [
    { label: 'Adult', options: AGE_GROUPS.filter((group) => !isYouth(group.key)) },
    { label: 'Youth', options: AGE_GROUPS.filter((group) => isYouth(group.key)) },
  ];
  protected readonly rosterSizeMax = ROSTER_SIZE_INPUT_MAX;
  protected readonly fieldClass = FIELD;
  protected readonly labelClass = LABEL;
  protected readonly inputClass = INPUT;
  protected readonly descriptionClass = DESCRIPTION;
  protected readonly errorClass = FIELD_ERROR;

  protected readonly ids = computed(() => {
    const prefix = this.idPrefix();
    return {
      gender: `${prefix}gender`,
      format: `${prefix}format`,
      level: `${prefix}level`,
      minimum: `${prefix}minimum-roster-size`,
      ageGroup: `${prefix}age-group`,
    };
  });

  private readonly formatGroup = viewChild<ChipRadioGroup>('formatGroup');
  private readonly levelGroup = viewChild<ChipRadioGroup>('levelGroup');
  private readonly customLevelPanel = viewChild(CustomLevelPanel);
  private readonly minimumInput = viewChild<ElementRef<HTMLInputElement>>('minimum');
  private readonly ageGroupSelect = viewChild<ElementRef<HTMLSelectElement>>('ageGroup');

  protected readonly formatOptions = computed<readonly ChipOption[]>(() =>
    playersPerSideOfSport(this.sport()).map((count) => ({
      key: String(count),
      label: formatLabel(count),
    })),
  );
  protected readonly chosenFormat = computed(() => {
    const count = this.division().playersPerSide();
    return count === null ? null : String(count);
  });
  private readonly customLevelList = injectQuery(api.customLevels.listForSport, () =>
    this.canAddCustomLevel()
      ? { organizationId: this.organizationId(), sport: this.sport() }
      : skipToken,
  );
  private readonly customLevels = computed<readonly OwnCustomLevel[]>(() => {
    const listed = this.customLevelList.value() ?? [];
    const own = this.ownCustomLevel();
    return own && !listed.some(({ customLevelId }) => customLevelId === own.customLevelId)
      ? [...listed, own]
      : listed;
  });
  protected readonly levelOptions = computed<readonly ChipOption[]>(() => [
    ...levelsOfSport(this.sport()).map((key) => ({ key, label: levelLabel(key) })),
    ...this.customLevels().map(({ customLevelId, name }) => ({
      key: `${CUSTOM_KEY_PREFIX}${customLevelId}`,
      label: name,
    })),
  ]);
  protected readonly chosenLevel = computed(() => {
    const customLevelId = this.division().customLevelId();
    return customLevelId === null
      ? this.division().level()
      : `${CUSTOM_KEY_PREFIX}${customLevelId}`;
  });
  protected readonly levelDescription = computed(() => {
    const standard = `Standard levels for ${SPORT_NAMES[this.sport()].toLowerCase()}.`;
    const custom = this.customLevels().map(
      ({ name, standardLevel }) => `${name} (filters as ${levelLabel(standardLevel)})`,
    );
    return custom.length === 0 ? standard : `${standard} Your custom levels: ${custom.join(', ')}.`;
  });

  private readonly minimumOpened = signal(false);
  // A typed value keeps the field in view, so a hidden minimum is never sent.
  protected readonly minimumShown = computed(
    () => this.minimumOpened() || this.division().minimumText() !== '',
  );

  protected describedBy(id: string, note: unknown, error: string | null): string {
    return [`${id}-description`, note ? `${id}-note` : null, error ? `${id}-error` : null]
      .filter((part) => part !== null)
      .join(' ');
  }

  protected chooseGender(key: string): void {
    const gender = GENDERS.find((candidate) => candidate === key);
    if (gender) this.division().chooseGender(gender);
  }

  protected chooseFormat(key: string): void {
    this.division().chooseFormat(Number(key));
  }

  protected chooseLevel(key: string): void {
    if (key.startsWith(CUSTOM_KEY_PREFIX)) {
      const custom = this.customLevels().find(
        ({ customLevelId }) => `${CUSTOM_KEY_PREFIX}${customLevelId}` === key,
      );
      if (custom) this.division().chooseCustomLevel(custom);
      return;
    }
    const level = levelsOfSport(this.sport()).find((candidate) => candidate === key);
    if (level) this.division().chooseLevel(level);
  }

  protected customLevelAdded({ customLevelId, standardLevel }: AddedCustomLevel): void {
    this.division().chooseCustomLevel({ customLevelId, standardLevel });
  }

  protected ageGroupChosen(event: Event): void {
    const key = (event.target as HTMLSelectElement).value;
    const ageGroup = AGE_GROUPS.find((candidate) => candidate.key === key);
    if (ageGroup) this.division().setAgeGroup(ageGroup.key);
  }

  protected minimumTyped(event: Event): void {
    this.division().setMinimumText((event.target as HTMLInputElement).value);
  }

  protected openMinimum(): void {
    this.minimumOpened.set(true);
    afterNextRender(() => this.minimumInput()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  collapseMinimum(): void {
    this.minimumOpened.set(false);
  }

  closeCustomLevelPanel(): void {
    this.customLevelPanel()?.closeAndDiscard();
  }

  focus(field: DivisionField): void {
    const targets = {
      format: () => this.formatGroup(),
      minimumRosterSize: () => this.minimumInput()?.nativeElement,
      level: () => this.levelGroup(),
      ageGroup: () => this.ageGroupSelect()?.nativeElement,
    } as const;
    targets[field]()?.focus();
  }
}
