import { computed, linkedSignal, signal, type Signal, type WritableSignal } from '@angular/core';
import { form, required, type FieldTree } from '@angular/forms/signals';
import { ConvexError } from 'convex/values';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  checkLeagueLocations,
  checkLeagueName,
  checkLeagueSlug,
  LEAGUE_MESSAGES,
  type LeagueField,
  type LeagueInputError,
} from '../../../../convex/lib/leagueInput';
import { slugify } from '../../../../convex/lib/slugs';
import type { Sport } from '../../../../convex/lib/sports';
import { ConvexOfflineError } from '../../core/data/convex';
import { changedSince, focusLeftGroup, ShownUntilValid } from '../../core/forms/shown-errors';

export type { LeagueField };
/** The fields in the order focus and errors follow (design/mockups/66-69-organization-leagues.html). */
export const LEAGUE_FIELDS: readonly LeagueField[] = ['name', 'slug', 'sport', 'locations'];

export interface LeagueTextModel {
  name: string;
  slug: string;
}

/** What `leagues.create` is called with, besides the organization. */
export interface LeagueValues {
  name: string;
  slug: string;
  sport: Sport;
  locationIds: Id<'locations'>[];
}

/** A failure that is not about one field: the form alert above the fields. */
export type LeagueFormAlertKind = 'offline' | 'failed';

/** The text of each form alert ("League messages"; design/mockups/88-offline-note.html state 3). */
export const LEAGUE_FORM_ALERTS = {
  failed: {
    title: 'The league could not be created.',
    description: 'Check your connection and try again.',
  },
  offline: {
    title: "You're offline. Nothing was sent.",
    description: "Your details are still here. Try again when you're connected.",
  },
} as const;

/** What a submit leaves the component to do: where focus goes, or nothing more. */
export type LeagueSubmitOutcome =
  | { sent: true; values: LeagueValues }
  | { sent: false; focus: LeagueField }
  | { sent: false; alert: LeagueFormAlertKind };

/** The reserved slug the format message names; the page prints it in bold (#64). */
const RESERVED_SLUG = 'new';

/** A refusal about one field, as `leagues.create` throws it (`ConvexError` data). */
interface ServerError {
  text: string;
  /** Set when the slug is taken: the message repeats it in bold. */
  taken: string | null;
}

/** The `LeagueInputError` a `ConvexError` carries, or `null` for any other failure. */
function inputErrorOf(failure: unknown): LeagueInputError | null {
  if (!(failure instanceof ConvexError)) return null;
  const data: unknown = failure.data;
  if (typeof data !== 'object' || data === null) return null;
  const { field, code, message } = data as Record<string, unknown>;
  if (typeof field !== 'string' || !(LEAGUE_FIELDS as readonly string[]).includes(field)) {
    return null;
  }
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { field: field as LeagueField, code: code as LeagueInputError['code'], message };
}

/**
 * The state of the create-league form (#66): the signal form for Name and Slug, the chosen sport
 * and locations, the messages each field shows, and the submit sequence. Like `LocationForm`,
 * errors show under their field when the user leaves a field they changed (`left`, `leftGroup`) and
 * after a submit, and clear once the field is valid; a server refusal about a field shows until
 * that field changes. Typing a name fills Slug with
 * `slugify(name)` until the user edits Slug (decision 3). Construct it in an injection context (a
 * component field initializer); `available` returns the ids of the organization's locations, in
 * the order the list shows them.
 */
export class LeagueForm {
  readonly model: WritableSignal<LeagueTextModel> = signal({ name: '', slug: '' });
  readonly fields: FieldTree<LeagueTextModel>;
  readonly sport = signal<Sport | null>(null);
  /** The checked locations; `chosen()` is those that still exist, in list order. */
  readonly selected = signal<ReadonlySet<Id<'locations'>>>(new Set());
  /** Set when the user types in Slug; from then on the name no longer changes it. */
  readonly slugEdited = signal(false);
  readonly submitting = signal(false);
  readonly alert = signal<LeagueFormAlertKind | null>(null);

  /** The chosen locations, in the order of the list. */
  readonly chosen: Signal<Id<'locations'>[]>;

  private readonly clientErrors: Record<LeagueField, Signal<string | null>>;
  private readonly shown: Record<LeagueField, ShownUntilValid>;
  /** True once the user has checked or unchecked a location. */
  private readonly locationsChanged = changedSince(() => this.selected());
  private readonly serverErrors: Record<LeagueField, WritableSignal<ServerError | null>>;

  /** The error each field shows now, or `null`. */
  readonly errors: Record<LeagueField, Signal<string | null>>;

  /** The slug named by the "taken" message while that message is the one Slug shows. */
  readonly takenSlug: Signal<string | null>;

  /**
   * The format message split around the reserved slug it names, so the page can bold `new` as for
   * organizations; `null` for any other slug message. The string stays shared.
   */
  readonly reservedParts: Signal<{ before: string; after: string } | null>;

  constructor(available: () => readonly Id<'locations'>[]) {
    // `required` puts the attribute on both inputs; the messages are ours (`leagueInput.ts`), so
    // the form and `leagues.create` agree.
    this.fields = form(this.model, (path) => {
      required(path.name);
      required(path.slug);
    });
    this.chosen = computed(() => available().filter((id) => this.selected().has(id)));
    this.clientErrors = {
      name: computed(() => {
        const checked = checkLeagueName(this.model().name);
        return checked.ok ? null : checked.error.message;
      }),
      slug: computed(() => checkLeagueSlug(this.model().slug)?.message ?? null),
      sport: computed(() => (this.sport() === null ? LEAGUE_MESSAGES.sportEmpty : null)),
      locations: computed(() => checkLeagueLocations(this.chosen().length)?.message ?? null),
    };
    // Slug counts as changed when the user typed in Name, which fills it. Sport is a radio group:
    // once chosen it is valid, so leaving it never shows an error and only a submit does.
    const changed: Record<LeagueField, () => boolean> = {
      name: () => this.fields.name().dirty(),
      slug: () => this.fields.slug().dirty() || this.fields.name().dirty(),
      sport: () => false,
      locations: () => this.locationsChanged(),
    };
    this.shown = Object.fromEntries(
      LEAGUE_FIELDS.map((field) => [
        field,
        new ShownUntilValid(() => this.clientErrors[field]() !== null, changed[field]),
      ]),
    ) as Record<LeagueField, ShownUntilValid>;
    this.serverErrors = {
      name: this.untilChanged(() => this.model().name),
      slug: this.untilChanged(() => this.model().slug),
      sport: this.untilChanged(() => this.sport()),
      locations: this.untilChanged(() => this.chosen()),
    };
    this.errors = {
      name: this.shownError('name'),
      slug: this.shownError('slug'),
      sport: this.shownError('sport'),
      locations: this.shownError('locations'),
    };
    this.takenSlug = computed(() =>
      this.shown.slug.shown() ? null : (this.serverErrors.slug()?.taken ?? null),
    );
    this.reservedParts = computed(() => {
      if (this.errors.slug() !== LEAGUE_MESSAGES.slugInvalid) return null;
      const message = LEAGUE_MESSAGES.slugInvalid;
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

  toggleLocation(id: Id<'locations'>, checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Empties every field (after a create succeeded). */
  clear(): void {
    this.model.set({ name: '', slug: '' });
    this.slugEdited.set(false);
    this.sport.set(null);
    this.selected.set(new Set());
    this.fields().reset();
    this.locationsChanged.set(false);
  }

  /** Focus left a field: its error shows if the user changed it and it is invalid (#205). */
  left(field: LeagueField): void {
    this.shown[field].left();
  }

  /** A `focusout` in a group of checkboxes: checked once focus leaves the whole group. */
  leftGroup(field: LeagueField, event: FocusEvent): void {
    if (focusLeftGroup(event)) this.left(field);
  }

  /**
   * One press of the submit button. Clears the form alert and checks every field; an invalid one
   * shows its message, and focus goes to the first (Name, Slug, Sport, Locations). Valid and
   * offline: the offline alert, nothing sent. Otherwise `send` runs with the trimmed name; a
   * refusal about a field shows on it, and any other failure shows the form alert.
   */
  async submit(
    online: boolean,
    send: (values: LeagueValues) => Promise<unknown>,
  ): Promise<LeagueSubmitOutcome> {
    this.alert.set(null);
    let firstInvalid: LeagueField | null = null;
    for (const field of LEAGUE_FIELDS) {
      this.shown[field].submitted();
      if (this.clientErrors[field]() !== null) firstInvalid ??= field;
    }
    if (firstInvalid) return { sent: false, focus: firstInvalid };

    // A press while offline is refused here; one the adapter refuses at call time (the 3-second
    // check, before the note has appeared) takes the same path below.
    if (!online) return this.showAlert('offline');

    const { name, slug } = this.model();
    const values: LeagueValues = {
      name: name.trim(),
      slug,
      sport: this.sport()!,
      locationIds: this.chosen(),
    };
    this.submitting.set(true);
    try {
      await send(values);
    } catch (failure) {
      return this.failed(failure, slug);
    } finally {
      this.submitting.set(false);
    }
    return { sent: true, values };
  }

  private failed(failure: unknown, slug: string): LeagueSubmitOutcome {
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

  private showAlert(alert: LeagueFormAlertKind): LeagueSubmitOutcome {
    this.alert.set(alert);
    return { sent: false, alert };
  }

  private untilChanged(value: () => unknown): WritableSignal<ServerError | null> {
    return linkedSignal<unknown, ServerError | null>({ source: value, computation: () => null });
  }

  private shownError(field: LeagueField): Signal<string | null> {
    return computed(() =>
      this.shown[field].shown()
        ? this.clientErrors[field]()
        : (this.serverErrors[field]()?.text ?? null),
    );
  }
}
