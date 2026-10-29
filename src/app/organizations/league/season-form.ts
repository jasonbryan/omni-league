import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import {
  checkSeasonFields,
  SEASON_FIELDS,
  type SeasonField,
  type SeasonInputError,
} from '../../../../convex/lib/seasonInput';
import { slugify } from '../../../../convex/lib/slugs';
import { ConvexOfflineError } from '../../core/data/convex';
import { ShownUntilValid } from '../../core/forms/shown-errors';

export { SEASON_FIELDS };
export type { SeasonField };

export interface SeasonTextModel {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
}

export interface SeasonValues {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
}

export type SeasonFormAlertKind = 'offline' | 'failed';

export const SEASON_FORM_ALERTS = {
  failed: {
    title: 'The season could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    description: "Your season details are still here. Try again when you're connected.",
  },
} as const;

export type SeasonSubmitOutcome =
  | { sent: true; values: SeasonValues }
  | { sent: false; focus: SeasonField }
  | { sent: false; leagueFormatMissing: true }
  | { sent: false; alert: SeasonFormAlertKind };

const RESERVED_SLUG = 'new';

interface ServerError {
  text: string;
  taken: string | null;
}

function isLeagueFormatMissing(failure: unknown): boolean {
  if (!(failure instanceof ConvexError)) return false;
  const data: unknown = failure.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)['code'] === 'leagueFormatMissing'
  );
}

function inputErrorOf(failure: unknown): SeasonInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(SEASON_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as SeasonField, code: code as SeasonInputError['code'], message };
}

const EMPTY: SeasonTextModel = {
  name: '',
  slug: '',
  startDate: '',
  endDate: '',
  registrationDeadline: '',
};

/** The rules and messages are `convex/lib/seasonInput.ts`, which `seasons.create` applies again. */
export class SeasonForm {
  readonly model: WritableSignal<SeasonTextModel> = signal({ ...EMPTY });
  readonly fields: FieldTree<SeasonTextModel>;
  readonly slugEdited = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<SeasonFormAlertKind | null>(null);

  private readonly clientErrors: Signal<Partial<Record<SeasonField, SeasonInputError>>>;
  private readonly shown: Record<SeasonField, ShownUntilValid>;
  private readonly serverErrors: Record<SeasonField, WritableSignal<ServerError | null>>;

  readonly errors: Record<SeasonField, Signal<string | null>>;

  readonly takenSlug: Signal<string | null>;

  readonly reservedParts: Signal<{ before: string; after: string } | null>;

  constructor() {
    // `required` puts the attribute on the inputs; the messages are ours (`seasonInput.ts`), so the
    // form and `seasons.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.slug);
      required(path.startDate);
      required(path.endDate);
      required(path.registrationDeadline);
    });
    this.clientErrors = computed(() => {
      const m = this.model();
      return checkSeasonFields({
        name: m.name,
        slug: m.slug,
        startDate: m.startDate,
        endDate: m.endDate,
        registrationDeadline: m.registrationDeadline,
      });
    });
    const sources: Record<SeasonField, () => unknown> = {
      name: () => this.model().name,
      slug: () => this.model().slug,
      startDate: () => this.model().startDate,
      endDate: () => this.model().endDate,
      registrationDeadline: () => this.model().registrationDeadline,
    };
    const slugChanged = () => this.fields.slug().dirty() || this.fields.name().dirty();
    const changed: Record<SeasonField, () => boolean> = {
      name: () => this.fields.name().dirty(),
      slug: slugChanged,
      startDate: () => this.fields.startDate().dirty(),
      endDate: () => this.fields.endDate().dirty(),
      registrationDeadline: () => this.fields.registrationDeadline().dirty(),
    };
    this.shown = Object.fromEntries(
      SEASON_FIELDS.map((field) => [
        field,
        new ShownUntilValid(() => this.clientErrors()[field] !== undefined, changed[field]),
      ]),
    ) as Record<SeasonField, ShownUntilValid>;
    this.serverErrors = Object.fromEntries(
      SEASON_FIELDS.map((field) => [field, this.untilChanged(sources[field])]),
    ) as Record<SeasonField, WritableSignal<ServerError | null>>;
    this.errors = Object.fromEntries(
      SEASON_FIELDS.map((field) => [field, this.shownError(field)]),
    ) as Record<SeasonField, Signal<string | null>>;
    this.takenSlug = computed(() =>
      this.shown.slug.shown() ? null : (this.serverErrors.slug()?.taken ?? null),
    );
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

  clear(): void {
    this.model.set({ ...EMPTY });
    this.slugEdited.set(false);
    this.fields().reset();
  }

  left(field: SeasonField): void {
    this.shown[field].left();
  }

  async submit(
    online: boolean,
    send: (values: SeasonValues) => Promise<unknown>,
  ): Promise<SeasonSubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: SeasonField | null = null;
    const errors = this.clientErrors();
    for (const field of SEASON_FIELDS) {
      this.shown[field].submitted();
      if (errors[field] !== undefined) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    const pressedOffline = !online;
    if (pressedOffline) return this.showAlert('offline');

    const m = this.model();
    const values: SeasonValues = {
      name: m.name.trim(),
      slug: m.slug,
      startDate: m.startDate,
      endDate: m.endDate,
      registrationDeadline: m.registrationDeadline,
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

  private failed(failure: unknown, slug: string): SeasonSubmitOutcome {
    if (failure instanceof ConvexOfflineError) return this.showAlert('offline');
    if (isLeagueFormatMissing(failure)) {
      return { sent: false, leagueFormatMissing: true };
    }
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

  private showAlert(alert: SeasonFormAlertKind): SeasonSubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: SeasonField): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown()
        ? (this.clientErrors()[field]?.message ?? null)
        : (this.serverErrors[field]()?.text ?? null),
    );
  }
}
