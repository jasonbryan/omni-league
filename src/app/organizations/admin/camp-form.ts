import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  CAMP_FIELDS,
  checkCampFields,
  type CampField,
  type CampInputError,
} from '../../../../convex/lib/campInput';
import { limitFromText } from '../../../../convex/lib/seasonInput';
import { slugify, slugTakenMessage } from '../../../../convex/lib/slugs';
import type { Sport } from '../../../../convex/lib/sports';
import { ConvexOfflineError } from '../../core/data/convex';
import { focusLeftGroup, ShownUntilValid } from '../../core/forms/shown-errors';
import { NOT_CHECKED, type WebAddressCheck } from '../../core/forms/slug-availability';
import type { AlertTexts } from './alert-text';

export type { CampField };

export interface CampTextModel {
  name: string;
  slug: string;
  minimumAge: string;
  maximumAge: string;
}

export interface CampCreateValues {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
  minimumAge: number;
  maximumAge: number;
}

export type CampFormAlertKind = 'offline' | 'failed';

export const CAMP_FORM_ALERTS = {
  failed: {
    title: 'The camp could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your details are still here. Try again when you're connected.",
  },
} as const satisfies AlertTexts<CampFormAlertKind>;

export type CampSubmitOutcome =
  | { sent: true; values: CampCreateValues }
  | { sent: false; focus: CampField }
  | { sent: false; alert: CampFormAlertKind };

const RESERVED_SLUG = 'new';

const EMPTY: CampTextModel = { name: '', slug: '', minimumAge: '', maximumAge: '' };

interface ServerError {
  text: string;
  taken: string | null;
}

function inputErrorOf(failure: unknown): CampInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(CAMP_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as CampField, code: code as CampInputError['code'], message };
}

/** The rules and messages are `convex/lib/campInput.ts`, which `camps.create` applies again. */
export class CampForm {
  readonly model: WritableSignal<CampTextModel> = signal({ ...EMPTY });
  readonly fields: FieldTree<CampTextModel>;
  private readonly chosenSport = signal<Sport | null>(null);
  readonly sport = this.chosenSport.asReadonly();
  readonly selected: WritableSignal<ReadonlySet<Id<'locations'>>>;
  readonly slugEdited = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<CampFormAlertKind | null>(null);

  readonly chosen: Signal<Id<'locations'>[]>;

  private readonly defaultSelected: () => ReadonlySet<Id<'locations'>>;
  private readonly clientErrors: Signal<Partial<Record<CampField, CampInputError>>>;
  private readonly shown: Record<CampField, ShownUntilValid>;
  private readonly locationsChanged = signal(false);
  private readonly serverErrors: Record<CampField, WritableSignal<ServerError | null>>;

  readonly errors: Record<CampField, Signal<string | null>>;

  readonly takenSlug: Signal<string | null>;

  readonly slugAvailable: Signal<boolean>;

  readonly slugStatusReservesRoom: Signal<boolean>;

  readonly reservedParts: Signal<{ before: string; after: string } | null>;

  constructor(
    available: () => readonly Id<'locations'>[],
    private readonly webAddress: WebAddressCheck = NOT_CHECKED,
  ) {
    // `required` puts the attribute on the inputs; the messages are ours (`campInput.ts`), so the
    // form and `camps.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.slug);
      required(path.minimumAge);
      required(path.maximumAge);
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
      return checkCampFields({
        name: m.name,
        slug: m.slug,
        sport: this.sport(),
        locationCount: this.chosen().length,
        minimumAge: limitFromText(m.minimumAge),
        maximumAge: limitFromText(m.maximumAge),
      });
    });
    const ages = () => `${this.model().minimumAge}|${this.model().maximumAge}`;
    const sources: Record<CampField, () => unknown> = {
      name: () => this.model().name,
      slug: () => this.model().slug,
      sport: () => this.sport(),
      locations: () => this.chosen(),
      // The order of the two ages is the error of the second, so either one changing may fix it.
      minimumAge: ages,
      maximumAge: ages,
    };
    const slugChanged = () => this.fields.slug().dirty() || this.fields.name().dirty();
    const changed: Record<CampField, () => boolean> = {
      name: () => this.fields.name().dirty(),
      slug: slugChanged,
      // A chosen radio is always valid, so leaving it cannot show an error.
      sport: () => false,
      locations: () => this.locationsChanged(),
      minimumAge: () => this.fields.minimumAge().dirty(),
      maximumAge: () => this.fields.maximumAge().dirty(),
    };
    this.shown = Object.fromEntries(
      CAMP_FIELDS.map((field) => [
        field,
        new ShownUntilValid(() => this.clientErrors()[field] !== undefined, changed[field]),
      ]),
    ) as Record<CampField, ShownUntilValid>;
    this.serverErrors = Object.fromEntries(
      CAMP_FIELDS.map((field) => [field, this.untilChanged(sources[field])]),
    ) as Record<CampField, WritableSignal<ServerError | null>>;
    this.errors = Object.fromEntries(
      CAMP_FIELDS.map((field) => [field, this.shownError(field)]),
    ) as Record<CampField, Signal<string | null>>;
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

  chooseSport(sport: Sport): void {
    this.chosenSport.set(sport);
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
    this.selected.set(this.defaultSelected());
    this.fields().reset();
    this.locationsChanged.set(false);
  }

  left(field: CampField): void {
    this.shown[field].left();
    if (field === 'slug') this.webAddress.left();
    // The order is the second age's error, but the user may leave the first age last. Not before the second age has been typed, so an empty one is not scolded.
    if (field === 'minimumAge' && this.fields.maximumAge().dirty()) this.shown.maximumAge.left();
  }

  leftGroup(field: CampField, event: FocusEvent): void {
    if (focusLeftGroup(event)) this.left(field);
  }

  async submit(
    online: boolean,
    send: (values: CampCreateValues) => Promise<unknown>,
  ): Promise<CampSubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: CampField | null = null;
    const errors = this.clientErrors();
    for (const field of CAMP_FIELDS) {
      this.shown[field].submitted();
      if (errors[field] !== undefined) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const m = this.model();
    const values: CampCreateValues = {
      name: m.name.trim(),
      slug: m.slug,
      sport: this.sport()!,
      locationIds: this.chosen(),
      minimumAge: limitFromText(m.minimumAge)!,
      maximumAge: limitFromText(m.maximumAge)!,
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

  private failed(failure: unknown, slug: string): CampSubmitOutcome {
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

  private showAlert(alert: CampFormAlertKind): CampSubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private takenBeforeSubmit(): string | null {
    return !this.submitting() && this.webAddress.answer() === 'taken' ? this.model().slug : null;
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: CampField): Signal<string | null> {
    return computed(() => {
      if (this.shown[field].shown()) return this.clientErrors()[field]?.message ?? null;
      const refused = this.serverErrors[field]()?.text;
      if (refused !== undefined) return refused;
      const taken = field === 'slug' ? this.takenBeforeSubmit() : null;
      return taken === null ? null : slugTakenMessage(taken);
    });
  }
}
