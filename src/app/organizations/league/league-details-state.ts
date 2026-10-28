import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import type { FunctionArgs } from 'convex/server';
import { api } from '../../../../convex/_generated/api';
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
import { ConvexError } from 'convex/values';
import { fieldNoteText, type FieldNote } from '../admin/field-note';
import { LeagueDivision, type DivisionDetail, type SavedDivision } from '../admin/league-division';
import { inputErrorOf } from '../admin/league-form';
import type { OrganizerLeague } from './league-context';

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

export type ExpectedDetails = NonNullable<FunctionArgs<typeof api.leagues.update>['expected']>;

export type NoteField = 'name' | DivisionDetail;

// The order of the page, which is the order the notes are announced in.
const NOTE_FIELDS: readonly NoteField[] = [
  'name',
  'gender',
  'format',
  'minimumRosterSize',
  'level',
  'ageGroup',
];

export type DetailsAlertKind = 'offline' | 'failed' | 'changed';

export interface CurrentLeague {
  name: string;
  division: OrganizerLeague['division'];
}

export function savedDetails(name: string, division: OrganizerLeague['division']): SavedDetails {
  return {
    name,
    division: division && {
      gender: division.gender,
      playersPerSide: division.playersPerSide,
      level: division.level,
      customLevelId: division.customLevel?.customLevelId,
      customLevelName: division.customLevel?.name,
      ageGroup: division.ageGroup,
      minimumRosterSize: division.minimumRosterSize,
    },
  };
}

function expectedOf(name: string, division: SavedDivision | undefined): ExpectedDetails {
  if (!division) return { name };
  const { customLevelId, minimumRosterSize } = division;
  return {
    name,
    gender: division.gender,
    playersPerSide: division.playersPerSide,
    level: division.level,
    ...(customLevelId !== undefined && { customLevelId }),
    ageGroup: division.ageGroup,
    ...(minimumRosterSize !== undefined && { minimumRosterSize }),
  };
}

// The refusal's data is the server's own, so only its outline is checked.
function currentLeagueOf(failure: unknown): CurrentLeague | null {
  if (!(failure instanceof ConvexError)) return null;
  const current = (failure.data as Record<string, unknown>)['current'] as
    { name?: unknown; division?: OrganizerLeague['division'] } | undefined;
  if (typeof current?.name !== 'string') return null;
  return { name: current.name, division: current.division };
}

export const DETAILS_ALERTS = {
  failed: {
    title: 'The league details could not be saved.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your changes are still here. Try again when you're connected.",
  },
  changed: {
    title: 'Someone else changed this league while you were editing.',
    description: 'Check the details and save again.',
  },
} as const;

export type DetailsSubmitOutcome<Result> =
  | { sent: true; values: DetailsValues; result: Result }
  | { sent: false; focus: DetailsField }
  | { sent: false; alert: DetailsAlertKind; current?: CurrentLeague };

export class LeagueDetails {
  readonly model: WritableSignal<{ name: string }> = signal({ name: '' });
  readonly fields: FieldTree<{ name: string }>;
  readonly division = new LeagueDivision();
  readonly submitting = signal(false);
  readonly alert = signal<DetailsAlertKind | null>(null);
  readonly errors: Record<DetailsField, Signal<string | null>>;
  readonly notes: Record<NoteField, Signal<FieldNote | null>>;
  readonly announcement: Signal<readonly string[]>;

  private readonly baselineName = signal('');
  private readonly nameNote = linkedSignal<string, FieldNote | null>({
    source: () => this.model().name,
    computation: () => null,
  });
  readonly editedSinceLoad = computed(
    () => this.model().name !== this.baselineName() || this.division.edited().size > 0,
  );
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
    this.notes = { name: this.nameNote, ...this.division.notes };
    const shownTexts = computed(() =>
      NOTE_FIELDS.flatMap((field) => {
        const note = this.notes[field]();
        return note ? [fieldNoteText(note)] : [];
      }),
    );
    this.announcement = linkedSignal<readonly string[], readonly string[]>({
      source: shownTexts,
      computation: (texts, previous) => {
        const announcedBefore = new Set(previous?.source);
        return texts.filter((text) => !announcedBefore.has(text));
      },
    });
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
    this.baselineName.set(saved.name);
    this.model.set({ name: saved.name });
    this.nameNote.set(null);
    if (saved.division) this.division.load(saved.division);
    else this.division.clear();
    this.fields().reset();
    this.alert.set(null);
    for (const field of DETAILS_FIELDS) this.shown[field].hide();
  }

  left(field: DetailsField): void {
    this.shown[field].left();
    if (field === 'name') this.fillDivisionFromName();
  }

  async submit<Result>(
    online: boolean,
    send: (values: DetailsValues, expected: ExpectedDetails) => Promise<Result>,
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
      const result = await send(values, expectedOf(this.baselineName(), this.division.baseline));
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
    if (name.trim() === this.baselineName().trim()) return;
    this.division.fillFromName(name, this.sport());
  }

  private failed(failure: unknown): DetailsSubmitOutcome<never> {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal?.code === 'changedSince') {
      const current = currentLeagueOf(failure);
      if (current) this.takeNewerLeague(savedDetails(current.name, current.division));
      this.alert.set('changed');
      return { sent: false, alert: 'changed', ...(current && { current }) };
    }
    if (refusal && (DETAILS_FIELDS as readonly string[]).includes(refusal.field)) {
      const field = refusal.field as DetailsField;
      this.serverErrors[field].set(refusal.message);
      return { sent: false, focus: field };
    }
    return this.showAlert('failed');
  }

  takeNewerLeague(newer: SavedDetails): void {
    if (newer.name !== this.baselineName()) {
      const typed = this.model().name.trim();
      if (typed === this.baselineName().trim()) {
        this.model.set({ name: newer.name });
        this.fields().reset();
        this.nameNote.set(null);
      } else {
        this.nameNote.set(
          typed === newer.name.trim() ? null : { kind: 'changed', value: newer.name },
        );
      }
      this.baselineName.set(newer.name);
    }
    if (newer.division) this.division.takeSavedByOthers(newer.division);
  }

  private showAlert(alert: DetailsAlertKind): DetailsSubmitOutcome<never> {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(value: () => unknown): WritableSignal<string | null> {
    return linkedSignal<unknown, string | null>({ source: value, computation: () => null });
  }
}
