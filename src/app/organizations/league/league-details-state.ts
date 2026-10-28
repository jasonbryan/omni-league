import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { AgeGroup, Gender, StandardLevel } from '../../../../convex/lib/divisions';
import {
  checkLeagueAgeGroup,
  checkLeagueFormat,
  checkLeagueLevel,
  checkLeagueMinimumRosterSize,
  checkLeagueName,
  type LeagueField,
} from '../../../../convex/lib/leagueInput';
import type { Sport } from '../../../../convex/lib/sports';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid, changedSince } from '../../core/forms/shown-errors';
import { LeagueDivision, type SavedDivision } from '../admin/league-division';
import { inputErrorOf } from '../admin/league-form';

export type DetailsField = Extract<
  LeagueField,
  'name' | 'format' | 'minimumRosterSize' | 'level' | 'ageGroup'
>;

// The order of the page, which is the order focus follows to the first invalid field.
export const DETAILS_FIELDS: readonly DetailsField[] = [
  'name',
  'format',
  'minimumRosterSize',
  'level',
  'ageGroup',
];

export interface DetailsValues {
  name: string;
  gender: Gender;
  playersPerSide: number;
  level: StandardLevel;
  customLevelId?: Id<'customLevels'>;
  ageGroup: AgeGroup;
  minimumRosterSize?: number;
}

export interface SavedDetails {
  name: string;
  division?: SavedDivision | undefined;
}

export type DetailsAlertKind = 'offline' | 'failed';

export const DETAILS_ALERTS = {
  failed: {
    title: 'The league details could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your changes are still here. Try again when you're connected.",
  },
} as const;

export type DetailsSubmitOutcome<Result> =
  | { sent: true; values: DetailsValues; result: Result }
  | { sent: false; focus: DetailsField }
  | { sent: false; alert: DetailsAlertKind };

export class LeagueDetails {
  readonly model: WritableSignal<{ name: string }> = signal({ name: '' });
  readonly fields: FieldTree<{ name: string }>;
  readonly division = new LeagueDivision();
  readonly submitting = signal(false);
  readonly alert = signal<DetailsAlertKind | null>(null);
  readonly errors: Record<DetailsField, Signal<string | null>>;

  private savedName = '';
  private readonly loadedKey = signal('');
  private readonly currentKey = computed(() =>
    [
      this.model().name,
      this.division.gender(),
      this.division.playersPerSide(),
      this.division.level(),
      this.division.customLevelId(),
      this.division.ageGroup(),
      this.division.minimumText(),
    ].join('|'),
  );
  readonly editedSinceLoad = computed(() => this.currentKey() !== this.loadedKey());
  private readonly clientErrors: Record<DetailsField, Signal<string | null>>;
  private readonly shown: Record<DetailsField, ShownUntilValid>;
  private readonly serverErrors: Record<DetailsField, WritableSignal<string | null>>;

  constructor(private readonly sport: () => Sport) {
    this.fields = form(this.model, (path) => {
      required(path.name);
    });
    this.clientErrors = {
      name: computed(() => {
        const checked = checkLeagueName(this.model().name);
        return checked.ok ? null : checked.error.message;
      }),
      format: computed(
        () => checkLeagueFormat(this.sport(), this.division.playersPerSide())?.message ?? null,
      ),
      minimumRosterSize: computed(() => {
        const playersPerSide = this.division.playersPerSide();
        if (playersPerSide === null) return null;
        return (
          checkLeagueMinimumRosterSize(playersPerSide, this.division.minimumRosterSize())
            ?.message ?? null
        );
      }),
      level: computed(() => checkLeagueLevel(this.sport(), this.division.level())?.message ?? null),
      ageGroup: computed(() => {
        const checked = checkLeagueAgeGroup(this.division.ageGroup());
        return checked.ok ? null : checked.error.message;
      }),
    };
    const changed: Record<DetailsField, () => boolean> = {
      name: () => this.fields.name().dirty(),
      // A chosen chip or option is always valid, so leaving it cannot show an error.
      format: () => false,
      minimumRosterSize: changedSince(this.division.minimumText),
      level: () => false,
      ageGroup: () => false,
    };
    this.shown = Object.fromEntries(
      DETAILS_FIELDS.map((field) => [
        field,
        new ShownUntilValid(() => this.clientErrors[field]() !== null, changed[field]),
      ]),
    ) as Record<DetailsField, ShownUntilValid>;
    this.serverErrors = {
      name: this.untilChanged(() => this.model().name),
      format: this.untilChanged(() => this.division.playersPerSide()),
      minimumRosterSize: this.untilChanged(() => this.division.minimumText()),
      level: this.untilChanged(() => `${this.division.level()}/${this.division.customLevelId()}`),
      ageGroup: this.untilChanged(() => this.division.ageGroup()),
    };
    this.errors = Object.fromEntries(
      DETAILS_FIELDS.map((field) => [
        field,
        computed(() =>
          this.shown[field].shown() ? this.clientErrors[field]() : this.serverErrors[field](),
        ),
      ]),
    ) as Record<DetailsField, Signal<string | null>>;
  }

  load(saved: SavedDetails): void {
    this.savedName = saved.name;
    this.model.set({ name: saved.name });
    if (saved.division) this.division.load(saved.division);
    else this.division.clear();
    this.fields().reset();
    this.loadedKey.set(this.currentKey());
    this.alert.set(null);
    for (const field of DETAILS_FIELDS) this.shown[field].hide();
  }

  left(field: DetailsField): void {
    this.shown[field].left();
    if (field === 'name') this.fillDivisionFromName();
  }

  async submit<Result>(
    online: boolean,
    send: (values: DetailsValues) => Promise<Result>,
  ): Promise<DetailsSubmitOutcome<Result>> {
    this.alert.set(null);
    // Enter in Name submits before Name is left.
    this.fillDivisionFromName();
    let firstInvalid: DetailsField | null = null;
    for (const field of DETAILS_FIELDS) {
      this.shown[field].submitted();
      if (this.clientErrors[field]() !== null) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };
    if (!online) return this.showAlert('offline');

    const customLevelId = this.division.customLevelId();
    const minimumRosterSize = this.division.minimumRosterSize();
    const values: DetailsValues = {
      name: this.model().name.trim(),
      gender: this.division.gender(),
      playersPerSide: this.division.playersPerSide()!,
      level: this.division.level(),
      ...(customLevelId !== null && { customLevelId }),
      ageGroup: this.division.ageGroup(),
      ...(minimumRosterSize !== undefined && { minimumRosterSize }),
    };
    this.submitting.set(true);
    try {
      const result = await send(values);
      return { sent: true, values, result };
    } catch (failure) {
      return this.failed(failure);
    } finally {
      this.submitting.set(false);
    }
  }

  // Only a rename can state a division, so a form saved without touching the name keeps its choices.
  private fillDivisionFromName(): void {
    const name = this.model().name;
    if (name.trim() === this.savedName.trim()) return;
    this.division.fillFromName(name, this.sport());
  }

  private failed(failure: unknown): DetailsSubmitOutcome<never> {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal && (DETAILS_FIELDS as readonly string[]).includes(refusal.field)) {
      const field = refusal.field as DetailsField;
      this.serverErrors[field].set(refusal.message);
      return { sent: false, focus: field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: DetailsAlertKind): DetailsSubmitOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(value: () => unknown): WritableSignal<string | null> {
    return linkedSignal<unknown, string | null>({ source: value, computation: () => null });
  }
}
