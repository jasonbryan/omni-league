import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import type { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { AgeGroup, Gender, StandardLevel } from '../../../../convex/lib/divisions';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import { slugify, slugTakenMessage } from '../../../../convex/lib/slugs';
import type { Sport } from '../../../../convex/lib/sports';
import {
  checkTournamentFields,
  TOURNAMENT_FIELDS,
  type TournamentField,
  type TournamentInputError,
} from '../../../../convex/lib/tournamentInput';
import { ConvexOfflineError, type api } from '../../core/data/convex';
import { focusLeftGroup, ShownUntilValid } from '../../core/forms/shown-errors';
import { NOT_CHECKED, type WebAddressCheck } from '../../core/forms/slug-availability';
import type { AlertTexts } from './alert-text';
import { LeagueDivision } from './league-division';

export type { TournamentField };

export interface TournamentTextModel {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  maximumTeams: string;
}

export interface TournamentCreateValues {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
  gender: Gender;
  playersPerSide: number;
  level: StandardLevel;
  customLevelId?: Id<'customLevels'>;
  ageGroup: AgeGroup;
  startDate: string;
  /** Left out for a one-day tournament. */
  endDate?: string;
  registrationDeadline: string;
  maximumTeams: number;
}

export type TournamentCopy = NonNullable<FunctionReturnType<typeof api.tournaments.getForCopy>>;

export type TournamentFormAlertKind = 'offline' | 'failed';

export const TOURNAMENT_FORM_ALERTS = {
  failed: {
    title: 'The tournament could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your details are still here. Try again when you're connected.",
  },
} as const satisfies AlertTexts<TournamentFormAlertKind>;

export type TournamentSubmitOutcome =
  | { sent: true; values: TournamentCreateValues }
  | { sent: false; focus: TournamentField }
  | { sent: false; alert: TournamentFormAlertKind };

const RESERVED_SLUG = 'new';

const EMPTY: TournamentTextModel = {
  name: '',
  slug: '',
  startDate: '',
  endDate: '',
  registrationDeadline: '',
  maximumTeams: '',
};

interface ServerError {
  text: string;
  taken: string | null;
}

function inputErrorOf(failure: unknown): TournamentInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(TOURNAMENT_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as TournamentField, code: code as TournamentInputError['code'], message };
}

/** The rules and messages are `convex/lib/tournamentInput.ts`, which `tournaments.create` applies again. */
export class TournamentForm {
  readonly model: WritableSignal<TournamentTextModel> = signal({ ...EMPTY });
  readonly fields: FieldTree<TournamentTextModel>;
  private readonly chosenSport = signal<Sport | null>(null);
  readonly sport = this.chosenSport.asReadonly();
  readonly division = new LeagueDivision();
  readonly selected: WritableSignal<ReadonlySet<Id<'locations'>>>;
  readonly slugEdited = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<TournamentFormAlertKind | null>(null);

  readonly chosen: Signal<Id<'locations'>[]>;

  private readonly defaultSelected: () => ReadonlySet<Id<'locations'>>;
  private readonly clientErrors: Signal<Partial<Record<TournamentField, TournamentInputError>>>;
  private readonly shown: Record<TournamentField, ShownUntilValid>;
  private readonly locationsChanged = signal(false);
  private readonly serverErrors: Record<TournamentField, WritableSignal<ServerError | null>>;

  readonly errors: Record<TournamentField, Signal<string | null>>;

  readonly takenSlug: Signal<string | null>;

  readonly slugAvailable: Signal<boolean>;

  readonly slugStatusReservesRoom: Signal<boolean>;

  readonly reservedParts: Signal<{ before: string; after: string } | null>;

  constructor(
    available: () => readonly Id<'locations'>[],
    private readonly webAddress: WebAddressCheck = NOT_CHECKED,
  ) {
    // `required` puts the attribute on the inputs; the messages are ours (`tournamentInput.ts`), so
    // the form and `tournaments.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.slug);
      required(path.startDate);
      required(path.registrationDeadline);
      required(path.maximumTeams);
    });
    // The source is the only location's id, not the list, so a list that emits again with the same
    // single location does not undo the user's choice.
    const onlyLocation = computed(() => {
      const ids = available();
      return ids.length === 1 ? ids[0] : null;
    });
    this.defaultSelected = (): ReadonlySet<Id<'locations'>> => {
      const only = onlyLocation();
      return new Set(only === null ? [] : [only]);
    };
    this.selected = linkedSignal<Id<'locations'> | null, ReadonlySet<Id<'locations'>>>({
      source: onlyLocation,
      computation: (only, previous) =>
        only === null ? (previous?.value ?? new Set()) : new Set([only]),
    });
    this.chosen = computed(() => available().filter((id) => this.selected().has(id)));
    this.clientErrors = computed(() => {
      const m = this.model();
      return checkTournamentFields({
        name: m.name,
        slug: m.slug,
        sport: this.sport(),
        playersPerSide: this.division.playersPerSide(),
        level: this.division.level(),
        ageGroup: this.division.ageGroup(),
        locationCount: this.chosen().length,
        startDate: m.startDate,
        endDate: m.endDate,
        registrationDeadline: m.registrationDeadline,
        maximumTeams: limitFromText(m.maximumTeams),
      });
    });
    const sources: Record<TournamentField, () => unknown> = {
      name: () => this.model().name,
      slug: () => this.model().slug,
      sport: () => this.sport(),
      format: () => this.division.playersPerSide(),
      level: () => `${this.division.level()}/${this.division.customLevelId()}`,
      ageGroup: () => this.division.ageGroup(),
      locations: () => this.chosen(),
      startDate: () => this.model().startDate,
      endDate: () => this.model().endDate,
      registrationDeadline: () => this.model().registrationDeadline,
      maximumTeams: () => this.model().maximumTeams,
    };
    const slugChanged = () => this.fields.slug().dirty() || this.fields.name().dirty();
    const changed: Record<TournamentField, () => boolean> = {
      name: () => this.fields.name().dirty(),
      slug: slugChanged,
      // A chosen radio is always valid, so leaving it cannot show an error.
      sport: () => false,
      format: () => false,
      level: () => false,
      ageGroup: () => false,
      locations: () => this.locationsChanged(),
      startDate: () => this.fields.startDate().dirty(),
      endDate: () => this.fields.endDate().dirty(),
      registrationDeadline: () => this.fields.registrationDeadline().dirty(),
      maximumTeams: () => this.fields.maximumTeams().dirty(),
    };
    this.shown = Object.fromEntries(
      TOURNAMENT_FIELDS.map((field) => [
        field,
        new ShownUntilValid(() => this.clientErrors()[field] !== undefined, changed[field]),
      ]),
    ) as Record<TournamentField, ShownUntilValid>;
    this.serverErrors = Object.fromEntries(
      TOURNAMENT_FIELDS.map((field) => [field, this.untilChanged(sources[field])]),
    ) as Record<TournamentField, WritableSignal<ServerError | null>>;
    this.errors = Object.fromEntries(
      TOURNAMENT_FIELDS.map((field) => [field, this.shownError(field)]),
    ) as Record<TournamentField, Signal<string | null>>;
    this.takenSlug = computed(() =>
      this.shown.slug.shown()
        ? null
        : (this.serverErrors.slug()?.taken ?? this.takenBeforeSubmit()),
    );
    this.slugAvailable = computed(
      () =>
        !this.submitting() &&
        this.webAddress.answer() === 'available' &&
        this.errors.slug() === null,
    );
    this.slugStatusReservesRoom = computed(() => this.errors.slug() === null);
    this.reservedParts = computed(() => {
      const message = this.errors.slug();
      if (message === null) return null;
      const at = message.indexOf(` ${RESERVED_SLUG},`) + 1;
      if (at === 0) return null;
      return { before: message.slice(0, at), after: message.slice(at + RESERVED_SLUG.length) };
    });
  }

  nameTyped(name: string): void {
    if (this.slugEdited()) return;
    this.model.update((m) => ({ ...m, name, slug: name.trim() === '' ? '' : slugify(name) }));
  }

  /** Leaves the dates blank and the web address as offered, so the name still derives it until the address is edited. */
  loadCopy(copy: TournamentCopy): void {
    this.model.update((m) => ({
      ...m,
      name: copy.name,
      slug: copy.slug,
      maximumTeams: String(copy.maximumTeams),
    }));
    this.slugEdited.set(false);
    this.chosenSport.set(copy.sport);
    this.division.load({
      gender: copy.gender,
      playersPerSide: copy.playersPerSide,
      level: copy.level,
      customLevelId: copy.customLevelId,
      ageGroup: copy.ageGroup,
    });
    this.selected.set(new Set(copy.locationIds));
  }

  chooseSport(sport: Sport): void {
    this.chosenSport.set(sport);
    this.division.sportChanged(sport);
    this.fillDivisionFromName();
  }

  toggleLocation(id: Id<'locations'>, checked: boolean): void {
    this.locationsChanged.set(true);
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  clear(): void {
    this.model.set({ ...EMPTY });
    this.slugEdited.set(false);
    this.chosenSport.set(null);
    this.division.clear();
    this.selected.set(this.defaultSelected());
    this.fields().reset();
    this.locationsChanged.set(false);
  }

  left(field: TournamentField): void {
    this.shown[field].left();
    if (field === 'name') this.fillDivisionFromName();
    if (field === 'slug') this.webAddress.left();
  }

  leftGroup(field: TournamentField, event: FocusEvent): void {
    if (focusLeftGroup(event)) this.left(field);
  }

  async submit(
    online: boolean,
    send: (values: TournamentCreateValues) => Promise<unknown>,
  ): Promise<TournamentSubmitOutcome> {
    this.alert.set(null);
    // Enter in Name submits before Name is left.
    this.fillDivisionFromName();
    let firstInvalid: TournamentField | null = null;
    const errors = this.clientErrors();
    for (const field of TOURNAMENT_FIELDS) {
      this.shown[field].submitted();
      if (errors[field] !== undefined) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const m = this.model();
    const customLevelId = this.division.customLevelId();
    const values: TournamentCreateValues = {
      name: m.name.trim(),
      slug: m.slug,
      sport: this.sport()!,
      locationIds: this.chosen(),
      gender: this.division.gender(),
      playersPerSide: this.division.playersPerSide()!,
      level: this.division.level(),
      ...(customLevelId !== null && { customLevelId }),
      ageGroup: this.division.ageGroup(),
      startDate: m.startDate,
      ...(m.endDate !== '' && { endDate: m.endDate }),
      registrationDeadline: m.registrationDeadline,
      maximumTeams: limitFromText(m.maximumTeams)!,
    };
    this.submitting.set(true);
    try {
      await send(values);
    } catch (failure) {
      return this.failed(failure, m.slug);
    } finally {
      this.submitting.set(false);
    }
    return { sent: true, values };
  }

  private fillDivisionFromName(): void {
    this.division.fillFromName(this.model().name, this.sport());
  }

  private failed(failure: unknown, slug: string): TournamentSubmitOutcome {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    const refusal = inputErrorOf(failure);
    if (refusal) {
      this.serverErrors[refusal.field].set({
        text: refusal.message,
        taken: refusal.code === 'slugTaken' ? slug : null,
      });
      return { sent: false, focus: refusal.field };
    }
    return this.showAlert('failed');
  }

  private showAlert(alert: TournamentFormAlertKind): TournamentSubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private takenBeforeSubmit(): string | null {
    return !this.submitting() && this.webAddress.answer() === 'taken' ? this.model().slug : null;
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: TournamentField): Signal<string | null> {
    return computed(() => {
      if (this.shown[field].shown()) return this.clientErrors()[field]?.message ?? null;
      const refused = this.serverErrors[field]()?.text;
      if (refused !== undefined) return refused;
      const taken = field === 'slug' ? this.takenBeforeSubmit() : null;
      return taken === null ? null : slugTakenMessage(taken);
    });
  }
}
