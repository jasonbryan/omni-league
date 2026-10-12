import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import {
  checkSeasonFields,
  parseWholeNumber,
  SEASON_FIELDS,
  type SeasonField,
  type SeasonInputError,
} from '../../../../convex/lib/seasonInput';
import { slugify } from '../../../../convex/lib/slugs';
import { SPORT_FORMATS, type Format, type Sport } from '../../../../convex/lib/sports';
import { ConvexOfflineError } from '../../core/data/convex';

export { SEASON_FIELDS };
export type { SeasonField };

/** The fields the signal form holds as text; the format is a radio group beside it. */
export interface SeasonTextModel {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  minimumRosterSize: string;
}

/** What `seasons.create` is called with, besides the league. */
export interface SeasonValues {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  format: Format;
  minimumRosterSize: number;
}

/** A failure that is not about one field: the form alert above the fields. */
export type SeasonFormAlertKind = 'offline' | 'failed';

/** The text of each form alert ("Messages and attributes"; design/mockups/88-offline-note.html state 3). */
export const SEASON_FORM_ALERTS = {
  failed: {
    title: 'The season could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "Your season details are still here. Try again when you're connected.",
  },
} as const;

/** What a submit leaves the component to do: where focus goes, or nothing more. */
export type SeasonSubmitOutcome =
  | { sent: true; values: SeasonValues }
  | { sent: false; focus: SeasonField }
  | { sent: false; alert: SeasonFormAlertKind };

/** The reserved slug the format message names; the page prints it in bold (#64). */
const RESERVED_SLUG = 'new';

/** A refusal about one field, as `seasons.create` throws it (`ConvexError` data). */
interface ServerError {
  text: string;
  /** Set when the slug is taken: the message repeats it in bold. */
  taken: string | null;
}

/** The `SeasonInputError` a `ConvexError` carries, or `null` for any other failure. */
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
  minimumRosterSize: '',
};

/**
 * The state of the create-season form (#125): the signal form for the text fields, the chosen
 * format, the messages each field shows, and the submit sequence. Like `LeagueForm`, errors show
 * after a submit, under their field, and clear once the field is valid; a server refusal about a
 * field shows until that field changes. Typing a name fills Slug with `slugify(name)` until the
 * user edits Slug, and choosing a format sets Minimum roster size to the format's minimum, which
 * the organizer may raise. The rules and messages are `convex/lib/seasonInput.ts`, which
 * `seasons.create` applies again. Construct it in an injection context (a component field
 * initializer); `sport` is the league's sport, whose formats the form offers.
 */
export class SeasonForm {
  readonly model: WritableSignal<SeasonTextModel> = signal({ ...EMPTY });
  readonly fields: FieldTree<SeasonTextModel>;
  readonly format = signal<Format | null>(null);
  /** Set when the user types in Slug; from then on the name no longer changes it. */
  readonly slugEdited = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<SeasonFormAlertKind | null>(null);

  private readonly clientErrors: Signal<Partial<Record<SeasonField, SeasonInputError>>>;
  private readonly shown: Record<SeasonField, WritableSignal<boolean>>;
  private readonly serverErrors: Record<SeasonField, WritableSignal<ServerError | null>>;

  /** The error each field shows now, or `null`. */
  readonly errors: Record<SeasonField, Signal<string | null>>;

  /** The slug named by the "taken" message while that message is the one Slug shows. */
  readonly takenSlug: Signal<string | null>;

  /**
   * The format message split around the reserved slug it names, so the page can bold `new` as for
   * organizations and leagues; `null` for any other slug message. The string stays shared.
   */
  readonly reservedParts: Signal<{ before: string; after: string } | null>;

  /** The formats of the league's sport, with the minimum each sets. */
  readonly formats: Signal<readonly { key: Format; name: string; minimumRosterSize: number }[]>;

  constructor(sport: () => Sport) {
    // `required` puts the attribute on the inputs; the messages are ours (`seasonInput.ts`), so the
    // form and `seasons.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.slug);
      required(path.startDate);
      required(path.endDate);
      required(path.registrationDeadline);
      required(path.minimumRosterSize);
    });
    this.formats = computed(() => SPORT_FORMATS[sport()]);
    this.clientErrors = computed(() => {
      const m = this.model();
      return checkSeasonFields(sport(), {
        name: m.name,
        slug: m.slug,
        startDate: m.startDate,
        endDate: m.endDate,
        registrationDeadline: m.registrationDeadline,
        format: this.format(),
        minimumRosterSize: parseWholeNumber(m.minimumRosterSize),
      });
    });
    const sources: Record<SeasonField, () => unknown> = {
      name: () => this.model().name,
      slug: () => this.model().slug,
      startDate: () => this.model().startDate,
      endDate: () => this.model().endDate,
      registrationDeadline: () => this.model().registrationDeadline,
      format: () => this.format(),
      minimumRosterSize: () => [this.model().minimumRosterSize, this.format()],
    };
    this.shown = Object.fromEntries(
      SEASON_FIELDS.map((field) => [field, this.shownUntilValid(field)]),
    ) as Record<SeasonField, WritableSignal<boolean>>;
    this.serverErrors = Object.fromEntries(
      SEASON_FIELDS.map((field) => [field, this.untilChanged(sources[field])]),
    ) as Record<SeasonField, WritableSignal<ServerError | null>>;
    this.errors = Object.fromEntries(
      SEASON_FIELDS.map((field) => [field, this.shownError(field)]),
    ) as Record<SeasonField, Signal<string | null>>;
    this.takenSlug = computed(() =>
      this.shown.slug() ? null : (this.serverErrors.slug()?.taken ?? null),
    );
    this.reservedParts = computed(() => {
      const message = this.errors.slug();
      if (message === null) return null;
      const at = message.indexOf(` ${RESERVED_SLUG},`) + 1;
      if (at === 0) return null;
      return { before: message.slice(0, at), after: message.slice(at + RESERVED_SLUG.length) };
    });
  }

  /** The user typed in Name: while Slug is untouched it follows (an empty name, an empty slug). */
  nameTyped(name: string): void {
    if (this.slugEdited()) return;
    this.model.update((m) => ({ ...m, name, slug: name.trim() === '' ? '' : slugify(name) }));
  }

  /** The user chose a format: Minimum roster size takes the format's minimum. */
  chooseFormat(key: Format): void {
    this.format.set(key);
    const chosen = this.formats().find((candidate) => candidate.key === key);
    if (chosen) {
      this.model.update((m) => ({ ...m, minimumRosterSize: String(chosen.minimumRosterSize) }));
    }
  }

  /** Empties every field (after a create succeeded). */
  clear(): void {
    this.model.set({ ...EMPTY });
    this.slugEdited.set(false);
    this.format.set(null);
  }

  /**
   * One press of the submit button. Clears the form alert and checks every field; an invalid one
   * shows its message, and focus goes to the first (Name, Slug, the dates, Format, Minimum).
   * Valid and offline: the offline alert, nothing sent. Otherwise `send` runs with the trimmed
   * name; a refusal about a field shows on it, and any other failure shows the form alert.
   */
  async submit(
    online: boolean,
    send: (values: SeasonValues) => Promise<unknown>,
  ): Promise<SeasonSubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: SeasonField | null = null;
    const errors = this.clientErrors();
    for (const field of SEASON_FIELDS) {
      const invalid = errors[field] !== undefined;
      this.shown[field].set(invalid);
      if (invalid) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    // A press while offline is refused here; one the adapter refuses at call time (the 3-second
    // check, before the note has appeared) takes the same path below.
    if (!online) return this.showAlert('offline');

    const m = this.model();
    const values: SeasonValues = {
      name: m.name.trim(),
      slug: m.slug,
      startDate: m.startDate,
      endDate: m.endDate,
      registrationDeadline: m.registrationDeadline,
      format: this.format()!,
      minimumRosterSize: parseWholeNumber(m.minimumRosterSize)!,
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

  private shownUntilValid(field: SeasonField): WritableSignal<boolean> {
    return linkedSignal<boolean, boolean>({
      source: () => this.clientErrors()[field] === undefined,
      computation: (valid, previous) => !valid && (previous?.value ?? false),
    });
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: SeasonField): Signal<string | null> {
    return computed(() =>
      this.shown[field]()
        ? (this.clientErrors()[field]?.message ?? null)
        : (this.serverErrors[field]()?.text ?? null),
    );
  }
}
